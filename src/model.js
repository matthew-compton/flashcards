import { normalizeLegacy } from './legacy.js';

import { nextReview, reviewField } from './review.js';
export { DAY, isExercise, nextReview, reviewField } from './review.js';

export function prepareLibrary(input) {
  const library = normalizeLegacy(input);
  const deckIds = new Set();
  for (const deck of library.decks) {
    if (deckIds.has(deck.id)) throw new Error('Duplicate deck in backup.');
    deckIds.add(deck.id);
    const cardIds = new Set();
    deck.cards = deck.cards.map((card, index) => {
      const id = card.id ?? 'imported-' + index;
      if (typeof id !== 'string' || !id || id.length > 100 || cardIds.has(id)) {
        throw new Error('Invalid card identifier in backup.');
      }
      cardIds.add(id);
      return { ...card, id };
    });
  }
  return library;
}

function newestFirst(a, b) {
  return Date.parse(b.checkedAt ?? 0) - Date.parse(a.checkedAt ?? 0);
}

function upsertFlag(card, updated) {
  card.flags = [updated, ...(card.flags ?? []).filter(flag => flag.id !== updated.id)];
}

function applyFields(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

function applyAnswer(state, card, event) {
  const { deck } = state;
  const { correct, direction, sessionId, mode } = event.payload;
  deck.attempts += 1;
  deck.correct += Number(correct);
  if (!deck.checkedAt || Date.parse(event.at) >= Date.parse(deck.checkedAt)) deck.checkedAt = event.at;
  const field = reviewField(direction);
  const previous = card[field];
  if (!previous || Date.parse(event.at) >= Date.parse(previous.reviewedAt)) {
    card[field] = nextReview(previous, correct, event.at);
  }
  if (!state.sessions) {
    const rows = (deck.sessions ?? []).map((session, index) => ({ session, sequence: -index - 1 }));
    const byKey = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.session.id, row.session.direction]);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    state.sessions = { rows, byKey, nextSequence: 0 };
  }
  const { rows, byKey } = state.sessions;
  const key = JSON.stringify([sessionId, direction]);
  let row = byKey.get(key);
  const old = row?.session;
  if (!row) {
    row = {};
    rows.push(row);
    byKey.set(key, row);
  }
  row.session = {
    id: sessionId, direction, mode, checkedAt: event.at,
    attempts: (old?.attempts ?? 0) + 1,
    correct: (old?.correct ?? 0) + Number(correct)
  };
  row.sequence = state.sessions.nextSequence++;
}

function indexDeck(deck) {
  return { deck, cards: new Map(deck.cards.map(card => [card.id, card])) };
}

// Replaying immutable events makes retries idempotent and lets offline answers merge.
export function materialize(records) {
  const ordered = [...records].sort((a, b) => {
    if (a.revision && b.revision) return a.revision - b.revision;
    if (a.revision) return -1;
    if (b.revision) return 1;
    return a.order - b.order || a.event.id.localeCompare(b.event.id);
  });
  let baseline;
  for (const { event } of ordered) {
    if (event.type === 'library.replace' || (event.type === 'library.initialize' && !baseline)) baseline = event;
  }
  if (!baseline) return { library: { version: 11, decks: [] }, generation: null };
  const library = structuredClone(baseline.payload.library);
  const decks = new Map(library.decks.map(deck => [deck.id, indexDeck(deck)]));
  const events = ordered.map(record => record.event).filter(event => event.generation === baseline.id && event !== baseline);
  const reversed = new Set(events.filter(event => event.type === 'answer.undo').map(event => event.payload.answerId));
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const event of events) {
    const payload = event.payload;
    if (event.type === 'deck.add') {
      if (!decks.has(payload.deck.id)) {
        const deck = structuredClone(payload.deck);
        library.decks.push(deck);
        decks.set(deck.id, indexDeck(deck));
      }
      continue;
    }
    const state = decks.get(payload.deckId);
    if (!state) continue;
    const { deck, cards } = state;
    if (event.type === 'deck.edit') {
      applyFields(deck, payload.fields);
      continue;
    }
    if (event.type === 'card.add') {
      if (!cards.has(payload.card.id)) {
        const card = structuredClone(payload.card);
        deck.cards.push(card);
        cards.set(card.id, card);
      }
      continue;
    }
    if (event.type === 'card.remove') {
      deck.cards = deck.cards.filter(card => card.id !== payload.cardId);
      cards.delete(payload.cardId);
      continue;
    }
    const card = cards.get(payload.cardId);
    if (!card) continue;
    if (event.type === 'answer' && !reversed.has(event.id)) applyAnswer(state, card, event);
    if (event.type === 'card.edit') {
      applyFields(card, payload.fields);
      if (payload.resetReview) {
        delete card.review;
        delete card.recallReview;
      }
    }
    if (event.type === 'flag.upsert') upsertFlag(card, structuredClone(payload.flag));
  }
  for (const { deck, sessions } of decks.values()) {
    if (sessions) deck.sessions = sessions.rows
      .sort((a, b) => newestFirst(a.session, b.session) || b.sequence - a.sequence)
      .map(row => row.session);
  }
  return { library, generation: baseline.id };
}

function changedFields(before, after, fields) {
  return Object.fromEntries(fields.filter(key => before[key] !== after[key]).map(key => [key, after[key] ?? null]));
}

export function changesBetween(before, after) {
  const operations = [];
  for (const deck of after.decks) {
    const oldDeck = before.decks.find(item => item.id === deck.id);
    if (!oldDeck) {
      operations.push({ type: 'deck.add', payload: { deck: { ...deck, cards: deck.cards.map(card => ({ ...card, id: card.id ?? crypto.randomUUID() })) } } });
      continue;
    }
    const fields = changedFields(oldDeck, deck, ['name', 'category', 'topic', 'frontLanguage', 'backLanguage']);
    if (Object.keys(fields).length) operations.push({ type: 'deck.edit', payload: { deckId: deck.id, fields } });
    for (const card of deck.cards) {
      const old = card.id ? oldDeck.cards.find(item => item.id === card.id) : undefined;
      if (!old) {
        operations.push({ type: 'card.add', payload: { deckId: deck.id, card: { ...card, id: card.id ?? crypto.randomUUID() } } });
        continue;
      }
      const fields = changedFields(old, card, ['fr', 'en', 'kind']);
      const resetReview = Boolean((old.review && !card.review) || (old.recallReview && !card.recallReview));
      if (Object.keys(fields).length || resetReview) {
        operations.push({ type: 'card.edit', payload: { deckId: deck.id, cardId: card.id, fields, resetReview } });
      }
      for (const flag of card.flags ?? []) {
        const previous = old.flags?.find(item => item.id === flag.id);
        if (JSON.stringify(previous) !== JSON.stringify(flag)) {
          operations.push({ type: 'flag.upsert', payload: { deckId: deck.id, cardId: card.id, flag } });
        }
      }
    }
    for (const card of oldDeck.cards) {
      if (!deck.cards.some(item => item.id === card.id)) operations.push({ type: 'card.remove', payload: { deckId: deck.id, cardId: card.id } });
    }
  }
  return operations;
}
