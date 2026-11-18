import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { validateSyncPage } from '../../src/events.js';

const url = process.env.FLASHCARDS_TEST_DATABASE_URL;
const owners = [randomUUID(), randomUUID()];
const seed = await makeDatabase();

async function makeDatabase() {
  let db;
  if (url) {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.pathname === '/flashcards_test',
      'Use a disposable local flashcards_test database');
    const pool = new pg.Pool({ connectionString: url });
    db = { exec: sql => pool.query(sql), transaction: async fn => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    }, close: () => pool.end() };
  } else {
    db = await PGlite.create();
  }
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${owners[0]}'), ('${owners[1]}');
  `);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(file, dir), 'utf8')); }
    catch (error) {
      await db.close();
      throw new Error(file + ': ' + error.message + ' at ' + (error.position ?? '?'));
    }
  }
  return db;
}

function event(type, payload, generation, schemaVersion = 1) {
  const id = randomUUID();
  return { id, generation: generation ?? id, type, at: '2026-11-18T09:00:00.000Z', schemaVersion, payload };
}

const baseline = () => event('library.initialize', { library: { version: 11, decks: [] } });
const answer = generation => event('answer', {
  deckId: 'demo', cardId: 'card-a', correct: true, direction: 'fr', sessionId: 'round-a', mode: 'deck'
}, generation);

function request(owner, fn) {
  return seed.transaction(async tx => {
    await tx.query(owner ? 'set local role authenticated' : 'set local role anon');
    if (owner) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
    return fn(tx);
  });
}

function sync(owner, after = 0, events = []) {
  return request(owner, async tx => {
    const { rows } = await tx.query('select public.sync_flashcards($1, $2::jsonb) as page', [after, JSON.stringify(events)]);
    return validateSyncPage(rows[0].page, after);
  });
}

test('actual SQL enforces account isolation, rejects anonymous access and accepts unversioned events', async () => {
  try {
    await assert.rejects(sync(null), /permission denied/);
    const initial = baseline();
    delete initial.schemaVersion;
    const page = await sync(owners[0], 0, [initial]);
    assert.deepEqual(page.events, [{ revision: 1, event: initial }]);
    await request(owners[1], async tx => {
      const { rows } = await tx.query('select event_id from public.flashcard_events');
      assert.equal(rows.length, 0);
    });
    assert.deepEqual((await sync(owners[1])).events, []);

    const duplicate = await sync(owners[0], 0, [initial]);
    assert.deepEqual(duplicate.events, page.events);
    const good = answer(initial.id);
    const wrong = answer(initial.id);
    wrong.payload.correct = 'true';
    await assert.rejects(sync(owners[0], 1, [good, wrong]), /flashcard_events_valid_payload/);
    assert.deepEqual((await sync(owners[0], 1)).events, []);

    const events = Array.from({ length: 500 }, () => answer(initial.id));
    await sync(owners[0], 1, events.slice(0, 200));
    await sync(owners[0], 201, events.slice(200, 400));
    await sync(owners[0], 401, events.slice(400));
    const first = await sync(owners[0]);
    assert.equal(first.events.length, 500);
    assert.equal(first.hasMore, true);
    const last = await sync(owners[0], 500);
    assert.deepEqual(last.events, [{ revision: 501, event: events.at(-1) }]);
    assert.equal(last.hasMore, false);

    const editorial = [
      event('deck.add', { deck: { id: 'test-deck', name: 'Synthetic', category: 'Practice', attempts: 0, correct: 0,
        cards: [{ id: 'test-card', fr: 'Question', en: 'Answer' }] } }, initial.id),
      event('deck.edit', { deckId: 'test-deck', fields: { frontLanguage: 'de', topic: null } }, initial.id),
      event('card.edit', { deckId: 'test-deck', cardId: 'test-card', fields: { fr: 'New question' }, resetReview: true }, initial.id),
      event('flag.upsert', { deckId: 'test-deck', cardId: 'test-card', flag: { id: 'flag', direction: 'fr',
        reason: 'context', note: '', flaggedAt: '2026-11-18T09:00:00Z', original: { fr: 'Question', en: 'Answer' } } }, initial.id)
    ];
    assert.deepEqual((await sync(owners[0], 501, editorial)).events.map(row => row.event), editorial);

    if (url) {
      const second = baseline();
      await sync(owners[1], 0, [second]);
      const values = [answer(second.id), answer(second.id)];
      await Promise.all(values.map(value => sync(owners[1], 1, [value])));
      const merged = await sync(owners[1], 1);
      assert.deepEqual(merged.events.map(row => row.revision), [2, 3]);
      assert.deepEqual(new Set(merged.events.map(row => row.event.id)), new Set(values.map(value => value.id)));
    }
  } finally { await seed.close(); }
});
