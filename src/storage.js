import { changesBetween, materialize, prepareLibrary } from './model.js';

const DB_NAME = 'french-flashcards-private-v1';

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('events', { keyPath: ['owner', 'event.id'] });
      store.createIndex('owner', 'owner');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error('The local save was interrupted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export class StudyStore extends EventTarget {
  constructor(client, owner, { databaseName = DB_NAME } = {}) {
    super();
    this.client = client;
    this.owner = owner;
    this.databaseName = databaseName;
    this.records = [];
    this.library = { version: 11, decks: [] };
    this.generation = null;
    this.running = null;
    this.localQueue = Promise.resolve();
    this.error = '';
    this.status = 'Loading saved progress…';
    this.closed = false;
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('flashcards-' + owner) : null;
    this.channel?.addEventListener('message', () => this.reload().then(() => this.sync()).catch(error => this.failed(error)));
  }

  async open() {
    this.db = await openDatabase(this.databaseName);
    await this.reload();
    this.timer = setInterval(() => this.sync(), 15_000);
    return this;
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.channel?.close();
    this.db?.close();
  }

  get pending() {
    return this.records.filter(record => !record.revision);
  }

  async reload() {
    if (this.closed) return;
    const transaction = this.db.transaction('events', 'readonly');
    const request = transaction.objectStore('events').index('owner').getAll(this.owner);
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (this.closed) return;
    this.records = rows;
    Object.assign(this, materialize(rows));
    this.dispatchEvent(new Event('change'));
  }

  async write(records) {
    if (this.closed) throw new Error('Sign in again to save your progress.');
    const transaction = this.db.transaction('events', 'readwrite');
    const completed = transactionResult(transaction);
    for (const record of records) transaction.objectStore('events').put({ ...record, owner: this.owner });
    await completed;
    await this.reload();
  }

  commit(operations) {
    const action = async () => {
      if (!this.generation) throw new Error('Import your existing library before studying.');
      const lastAt = this.records.reduce((max, record) => Math.max(max, Date.parse(record.event.at)), 0);
      const timestamp = Math.max(Date.now(), lastAt + 1);
      const records = operations.map((operation, index) => ({
        revision: null,
        order: timestamp + index,
        event: { ...operation, id: crypto.randomUUID(), generation: this.generation, at: new Date(timestamp + index).toISOString() }
      }));
      await this.write(records);
      this.channel?.postMessage('changed');
      this.sync();
      return records.map(record => record.event);
    };
    const result = this.localQueue.then(action);
    this.localQueue = result.catch(() => {});
    return result;
  }

  async saveLibrary(before, after) {
    const operations = changesBetween(before, after);
    if (operations.length) await this.commit(operations);
  }

  async importLibrary(input, { sourceHash } = {}) {
    const library = prepareLibrary(input);
    const id = crypto.randomUUID();
    const now = Date.now();
    const event = {
      id, generation: id, type: this.generation ? 'library.replace' : 'library.initialize',
      at: new Date(now).toISOString(), payload: { library, ...(sourceHash ? { sourceHash } : {}) }
    };
    await this.write([{ event, revision: null, order: now }]);
    this.channel?.postMessage('changed');
    await this.sync();
    return library;
  }

  failed(error) {
    this.error = error.message ?? String(error);
    this.status = this.pending.length ? 'Saved on this device · waiting to sync' : 'Connection unavailable';
    this.dispatchEvent(new Event('status'));
  }

  sync() {
    if (this.closed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.performSync().catch(error => this.failed(error)).finally(() => {
      this.running = null;
      if (this.pending.length && !this.error && !this.closed) queueMicrotask(() => this.sync());
    });
    return this.running;
  }

  async performSync() {
    this.status = 'Syncing…';
    this.dispatchEvent(new Event('status'));
    let more = true;
    while (more && !this.closed) {
      const after = this.records.reduce((max, record) => Math.max(max, record.revision ?? 0), 0);
      const pending = this.pending.slice(0, 200).map(record => record.event);
      const { data, error } = await this.client.rpc('sync_flashcards', { after_revision: after, new_events: pending });
      if (error) throw error;
      if (this.closed) return;
      if (!data || !Array.isArray(data.events)) throw new Error('The sync response was incomplete. Your local progress is saved.');
      if (data.events.length) await this.write(data.events.map(record => ({ ...record, order: Date.parse(record.event.at) })));
      more = data.hasMore || this.pending.length > 0;
      if (more && !data.events.length) throw new Error('Sync could not confirm the pending changes. Please retry.');
    }
    this.error = '';
    this.status = 'Synced';
    this.dispatchEvent(new Event('status'));
  }
}
