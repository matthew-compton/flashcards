import test from 'node:test';
import assert from 'node:assert/strict';
import { materialize, prepareLibrary, changesBetween, DAY } from '../src/model.js';

export function library() {
  return { version: 11, decks: [{
    id: 'test-deck', name: 'Practice', category: 'Test', attempts: 10, correct: 8,
    checkedAt: '2026-11-18T09:00:00.000Z',
    sessions: [{ id: 'existing-session', attempts: 10, correct: 8, direction: 'fr', checkedAt: '2026-11-18T09:00:00.000Z' }],
    cards: [{ id: 'first', fr: 'example prompt', en: 'example answer' }, { id: 'second', fr: 'another prompt', en: 'another answer' }]
  }] };
}

function baseline(input = library()) {
  return { revision: 1, event: { id: 'initial', type: 'library.initialize', at: '2026-11-18T09:00:00.000Z', payload: { library: input } } };
}

function answer(id, at, direction, correct, cardId = 'first', sessionId = id) {
  return { id, generation: 'initial', type: 'answer', at, payload: { deckId: 'test-deck', cardId, sessionId, direction, correct, mode: 'deck' } };
}

test('migration retains existing scores, history, schedules, flags, and stable card identity', () => {
  const input = library();
  input.decks[0].cards[0].review = { step: 1, reviewedAt: '2026-11-18T09:00:00.000Z', dueAt: '2026-11-25T09:00:00.000Z' };
  input.decks[0].cards[0].flags = [{ id: 'test-flag', reason: 'context', direction: 'fr', note: 'A test note', flaggedAt: '2026-11-18T09:00:00.000Z', original: { fr: 'example prompt', en: 'example answer' } }];
  assert.deepEqual(prepareLibrary(input), input);
  assert.deepEqual(input, prepareLibrary(prepareLibrary(input)));
  const withoutIds = structuredClone(input);
  delete withoutIds.decks[0].cards[0].id;
  assert.equal(prepareLibrary(withoutIds).decks[0].cards[0].id, 'imported-0');
});

test('two devices merge independent directions and per-session scores without replacing baseline history', () => {
  const a = answer('a', '2026-11-18T10:00:00.000Z', 'fr', true);
  const b = answer('b', '2026-11-18T11:00:00.000Z', 'en', false);
  const { library: result } = materialize([baseline(), { revision: 3, event: b }, { revision: 2, event: a }]);
  const deck = result.decks[0];
  assert.equal(deck.attempts, 12);
  assert.equal(deck.correct, 9);
  assert.equal(deck.sessions.length, 3);
  assert.equal(deck.sessions.find(session => session.direction === 'en').correct, 0);
  assert.equal(deck.cards[0].review.dueAt, '2026-11-25T10:00:00.000Z');
  assert.equal(deck.cards[0].recallReview.dueAt, '2026-11-19T11:00:00.000Z');
  assert.equal(result.decks[0].sessions.at(-1).id, 'existing-session');
});

test('late-uploaded offline answers replay in study order and never move a schedule backward', () => {
  const early = answer('early', '2026-11-18T10:00:00.000Z', 'fr', false);
  const later = answer('later', '2026-11-19T11:00:00.000Z', 'fr', true);
  const events = [baseline(), { revision: 2, event: later }, { revision: 3, event: early }];
  const result = materialize(events).library.decks[0];
  assert.equal(result.cards[0].review.step, 1);
  assert.equal(result.cards[0].review.dueAt, '2026-11-26T11:00:00.000Z');
  assert.equal(result.sessions[0].id, 'later');
});

test('Undo removes exactly its target answer while preserving concurrent answers and flags', () => {
  const a = answer('a', '2026-11-18T10:00:00.000Z', 'fr', true);
  const b = answer('b', '2026-11-18T11:00:00.000Z', 'fr', false, 'second');
  const undo = { id: 'undo', type: 'answer.undo', generation: 'initial', at: '2026-11-18T12:00:00.000Z', payload: { answerId: 'a' } };
  const result = materialize([baseline(), {revision:2,event:a},{revision:3,event:b},{revision:4,event:undo}]).library.decks[0];
  assert.equal(result.attempts, 11);
  assert.equal(result.correct, 8);
  assert.equal(result.cards[0].review, undefined);
  assert.equal(result.cards[1].review.step, 0);
  assert.equal(result.sessions.some(session => session.id === 'a'), false);
});

test('editing a flagged card emits independent content and flag changes and preserves historical scores', () => {
  const before = library();
  before.decks[0].cards[0].review = {step:1,reviewedAt:'2026-11-18T09:00:00.000Z',dueAt:'2026-11-25T09:00:00.000Z'};
  const after = structuredClone(before);
  after.decks[0].cards[0].fr = 'clearer example prompt';
  delete after.decks[0].cards[0].review;
  after.decks[0].cards[0].flags = [{id:'f',reason:'context',direction:'fr',flaggedAt:'2026-11-18T11:00:00.000Z',original:{fr:'example prompt',en:'example answer'},note:''}];
  const changes = changesBetween(before, after).map((event,index) => ({revision:2+index,event:{...event,id:'edit-'+index,generation:'initial',at:'2026-11-18T11:00:00.000Z'}}));
  const result = materialize([baseline(before), ...changes]).library.decks[0];
  assert.equal(result.cards[0].fr, 'clearer example prompt');
  assert.equal(result.cards[0].review, undefined);
  assert.equal(result.cards[0].flags[0].original.fr, 'example prompt');
  assert.equal(result.correct, 8);
  assert.deepEqual(result.sessions, before.decks[0].sessions);
});

test('restoring a backup starts a new generation and excludes stale offline edits', () => {
  const replacement = { id: 'replacement', type: 'library.replace', generation:'replacement', at: '2026-11-20T10:00:00.000Z', payload: {library:library()} };
  const stale = answer('stale','2026-11-21T10:00:00.000Z','fr',false);
  const result = materialize([baseline(),{revision:2,event:replacement},{revision:3,event:stale}]);
  assert.equal(result.generation, 'replacement');
  assert.equal(result.library.decks[0].attempts, 10);
});

test('parallel first imports initialize once, preserving the first committed library', () => {
  const other = baseline();
  other.revision = 2;
  other.event.id = 'other';
  other.event.payload.library.decks[0].correct = 7;
  assert.equal(materialize([other, baseline()]).library.decks[0].correct, 8);
});

test('review intervals remain exact durations across daylight-saving changes', () => {
  const a = answer('dst', '2027-03-27T22:00:00.000Z', 'fr', true);
  const result = materialize([baseline(),{revision:2,event:a}]).library.decks[0].cards[0].review;
  assert.equal(Date.parse(result.dueAt) - Date.parse(result.reviewedAt), 7 * DAY);
});
