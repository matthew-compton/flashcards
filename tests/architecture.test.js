import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAccountLifecycle } from '../src/account.js';
import { resolveFlag, splitCard } from '../src/card-edits.js';
import { validateEvent, validateSyncPage } from '../src/events.js';
import { materialize, prepareLibrary } from '../src/model.js';
import { DAY, cardText, firstSide, reviewBuckets, selectReview } from '../src/review.js';
import { createRound, flipRound, gradeRound, skipRound, undoRound } from '../src/round.js';

const example = (at = '2026-11-18T00:00:00.000Z') => ({
  version: 11, decks: [{
    id: 'one', name: 'One', category: 'Synthetic', attempts: 4, correct: 3,
    sessions: [{ id: 'prior', direction: 'fr', attempts: 4, correct: 3, checkedAt: at }],
    cards: [{ id: 'a', fr: 'alpha', en: 'first', kind: 'grammar',
      review: { step: 0, reviewedAt: at, dueAt: new Date(Date.parse(at) + DAY).toISOString() },
      flags: [{ id: 'flag', direction: 'exercise', reason: 'context', note: 'Split', flaggedAt: at,
        original: { fr: 'alpha', en: 'first' } }] }]
  }]
});

test('a successful delayed grade owns its original round and leaves the new round intact', async () => {
  const original = createRound([{ deckId: 'one', cardId: 'a' }], { id: 'first' });
  let active = original;
  let finish;
  let written;
  flipRound(original);
  const saving = gradeRound(original, { correct: true, direction: 'fr',
    isCurrent: () => active === original, persist: operation => {
      written = operation;
      return new Promise(resolve => { finish = resolve; });
    } });
  active = createRound([{ deckId: 'two', cardId: 'b' }], { id: 'second' });
  finish({ id: 'first-answer' });
  assert.equal(await saving, false);
  assert.equal(written.payload.sessionId, 'first');
  assert.equal(active.index, 0);
  assert.equal(active.lastGrade, null);
});

test('skip safely rotates the current card and undo targets the last committed answer', async () => {
  const round = createRound([{ deckId: 'one', cardId: 'a' }, { deckId: 'one', cardId: 'b' }], { id: 'round' });
  const operations = [];
  const status = { isCurrent: () => true, persist: async op => { operations.push(op); return { id: 'event' }; } };
  assert.equal(skipRound(round), true);
  assert.equal(round.cards[0].cardId, 'b');
  flipRound(round);
  assert.equal(await gradeRound(round, { correct: true, direction: 'en', ...status }), true);
  assert.equal(await undoRound(round, status), 'en');
  assert.deepEqual(operations[1], { type: 'answer.undo', payload: { answerId: 'event' } });
  assert.equal(round.index, 0);
  assert.equal(round.revealed, true);
});

test('review policy includes the seven-day boundary and keeps fixed exercises direction-independent', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const miss = ms => ({ step: 0, reviewedAt: new Date(now - ms).toISOString(), dueAt: new Date(now).toISOString() });
  const { decks } = example();
  const [first] = decks;
  first.cards[0].review = miss(7 * DAY);
  first.cards.push({ id: 'just-outside', fr: 'beta', en: 'second', recallReview: miss(7 * DAY + 1) });
  decks.push({ ...first, id: 'two', category: 'Other', cards: [{ id: 'recall', fr: 'gamma', en: 'third', recallReview: miss(DAY) }] });
  const settings = { mode: 'missed', direction: 'en', sections: new Set(['Synthetic', 'Other']) };
  assert.deepEqual(reviewBuckets(decks, settings, now).map(({ cards }) => cards.map(card => card.cardId)), [['a'], ['recall']]);
  assert.deepEqual(selectReview(decks, settings, { now, random: () => 0 }).map(card => card.deckId), ['two', 'one']);
  assert.equal(cardText(first.cards[0], firstSide('en')), 'first');
});

test('v3 history and v8 legacy calendar schedules upgrade reproducibly', () => {
  const v3 = { version: 3, decks: [{ id: 'echange-1', name: 'One', category: 'A1', attempts: 4, correct: 3,
    lastSession: { attempts: 4, correct: 3 }, cards: [{ fr: 'alpha', en: 'first' }] }] };
  const upgraded = prepareLibrary(v3).decks[0];
  assert.equal(upgraded.checkedAt, '2026-11-12');
  assert.equal(upgraded.sessions[0].direction, 'fr');
  assert.equal(upgraded.sessions[0].correct, 3);
  assert.equal(upgraded.cards[0].id, 'imported-0');
  const v8 = structuredClone(v3);
  v8.version = 8;
  delete v8.decks[0].lastSession;
  v8.decks[0].cards[0].review = { step: 1, dueOn: '2026-11-19' };
  const previousTZ = process.env.TZ;
  try {
    for (const tz of ['Europe/Zurich', 'America/New_York']) {
      process.env.TZ = tz;
      assert.equal(prepareLibrary(v8).decks[0].cards[0].review.dueAt, '2026-11-25T23:59:59.999Z');
    }
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('split preview preserves score history and flags while both cards start fresh', () => {
  const library = example();
  const original = library.decks[0].cards[0];
  const ref = { deckId: 'one', cardId: 'a' };
  const parts = [{ front: 'Question A', back: 'Answer A' }, { front: 'Question B', back: 'Answer B' }];
  const plan = splitCard(library, ref, parts, { uuid: () => 'new-card' });
  assert.equal(plan.preview.length, 2);
  assert.equal(original.fr, 'alpha');
  const first = { revision: 1, event: { id: 'base', type: 'library.initialize', payload: { library } } };
  const ops = [...plan.operations, resolveFlag(library, ref, 'flag', '2026-11-18T10:00:00Z', parts[0])];
  const records = ops.map((op, index) => ({ revision: 2 + index,
    event: { ...op, id: 'edit-' + index, generation: 'base', at: '2026-11-18T10:00:00Z' } }));
  const [deck] = materialize([first, ...records]).library.decks;
  assert.deepEqual(deck.sessions, library.decks[0].sessions);
  assert.equal(deck.attempts, 4);
  assert.deepEqual(deck.cards.map(c => [c.id, c.fr, c.review]), [['a', 'Question A', undefined], ['new-card', 'Question B', undefined]]);
  assert.equal(deck.cards[0].flags[0].original.fr, 'alpha');
  assert.equal(deck.cards[0].flags[0].revision.fr, 'Question A');
});

test('event contract accepts old envelopes and rejects malformed fields and missing revisions', () => {
  const id = randomUUID();
  const value = { id, generation: id, at: '2026-11-18T10:00:00Z', type: 'answer', payload: {
    deckId: 'one', cardId: 'a', correct: false, direction: 'fr', mode: 'deck', sessionId: 'round'
  } };
  assert.equal(validateEvent(value), value);
  assert.throws(() => validateEvent({ ...value, schemaVersion: 2 }), /newer version/);
  assert.throws(() => validateEvent({ ...value, payload: { ...value.payload, correct: 1 } }), /invalid/);
  assert.throws(() => validateSyncPage({ events: [{ revision: 7, event: value }], hasMore: false }, 5), /incomplete/);
});

test('account lifecycle deduplicates refresh, isolates caches and recovers after a failed open', async () => {
  const actions = [];
  const account = createAccountLifecycle({
    async open(user) {
      actions.push('open ' + user.id);
      if (user.id === 'bad') throw new Error('offline storage');
      return { close: () => actions.push('close ' + user.id) };
    },
    reset: user => actions.push('reset ' + (user?.id ?? 'signed-out')),
    ready: (_, user) => actions.push('ready ' + user.id),
    failed: error => actions.push(error.message)
  });
  await Promise.all(['one', 'one', 'bad', 'two'].map(id => account.switchTo({ id })));
  await account.switchTo(null);
  assert.deepEqual(actions, ['reset one', 'open one', 'ready one', 'close one', 'reset bad', 'open bad',
    'offline storage', 'reset two', 'open two', 'ready two', 'close two', 'reset signed-out']);
  assert.equal(account.store, null);
});
