import { startCloud as startAccount } from '../../src/cloud.js';
import { StudyStore } from '../../src/storage.js';

const owner = localStorage.getItem('test-owner') || crypto.randomUUID();
localStorage.setItem('test-owner', owner);
const user = { id: owner, email: 'test@example.invalid' };
let authListener;
let releaseSave;
let waiting = false;

// These controls exist only in the synthetic test build.
window.flashcardsTest = {
  releaseName: __FIXTURE_RELEASE__,
  holdNextSave() { waiting = true; },
  get hasHeldSave() { return Boolean(releaseSave); },
  release() { releaseSave?.(); }
};

const fixtureLibrary = {
  version: 11, decks: [
    { id: 'one', name: 'Sample one', category: 'Synthetic', correct: 0, attempts: 0,
      cards: [{ fr: 'alpha', en: 'first' }, { fr: 'beta', en: 'second' }, { fr: 'gamma', en: 'third' }] },
    { id: 'two', name: 'Sample two', category: 'Synthetic', correct: 0, attempts: 0,
      cards: [{ fr: 'delta', en: 'fourth' }, { fr: 'epsilon', en: 'fifth' }] }
  ]
};

const client = {
  auth: {
    onAuthStateChange(listener) { authListener = listener; },
    async getSession() { return { data: { session: localStorage.getItem('test-signed-out') ? null : { user } } }; },
    async signOut() {
      localStorage.setItem('test-signed-out', '1');
      authListener('SIGNED_OUT', null);
      return {};
    }
  },
  async rpc(name, args) {
    const response = await fetch('/test-sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, name, args })
    });
    if (!response.ok) return { error: new Error('Test sync failed') };
    return { data: await response.json() };
  }
};

export function startCloud(callbacks) {
  return startAccount(callbacks, {
    client,
    async openStore(connection, account) {
      const store = await new StudyStore(connection, account).open();
      await store.sync();
      if (!store.generation) await store.importLibrary(fixtureLibrary);
      const commit = store.commit.bind(store);
      store.commit = async (...args) => {
        if (waiting) {
          waiting = false;
          await new Promise(resolve => { releaseSave = resolve; });
          releaseSave = null;
        }
        return commit(...args);
      };
      return store;
    }
  });
}
