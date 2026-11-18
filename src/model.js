import { normalizeLegacy } from './legacy.js';

export const DAY = 86_400_000;
const intervals = [1, 7, 14, 30, 60, 60, 60];

export function isExercise(card) {
  return card.kind === 'grammar' || card.kind === 'conjugation';
}

export function reviewField(direction) {
  return direction === 'en' ? 'recallReview' : 'review';
}

export function nextReview(previous, correct, at) {
  const now = Date.parse(at);
  let step = 0;
  if (correct) {
    const oldStep = previous?.step ?? 0;
    const advance = oldStep === 0 || Date.parse(previous.dueAt) <= now;
    step = Math.min(oldStep + Number(advance), intervals.length - 1);
  }
  return { step, reviewedAt: at, dueAt: new Date(now + intervals[step] * DAY).toISOString() };
}

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

function applyAnswer(deck, card, event) {
  const { correct, direction, sessionId, mode } = event.payload;
  deck.attempts += 1;
  deck.correct += Number(correct);
  if (!deck.checkedAt || Date.parse(event.at) >= Date.parse(deck.checkedAt)) deck.checkedAt = event.at;
  const field = reviewField(direction);
  const previous = card[field];
  if (!previous || Date.parse(event.at) >= Date.parse(previous.reviewedAt)) {
    card[field] = nextReview(previous, correct, event.at);
  }
  const sessions = deck.sessions ?? [];
  const old = sessions.find(session => session.id === sessionId && session.direction === direction);
  const updated = {
    id: sessionId, direction, mode, checkedAt: event.at,
    attempts: (old?.attempts ?? 0) + 1,
    correct: (old?.correct ?? 0) + Number(correct)
  };
  deck.sessions = [updated, ...sessions.filter(session => session !== old)].sort(newestFirst);
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
  const events = ordered.map(record => record.event).filter(event => event.generation === baseline.id && event !== baseline);
  const reversed = new Set(events.filter(event => event.type === 'answer.undo').map(event => event.payload.answerId));
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const event of events) {
    const payload = event.payload;
    if (event.type === 'deck.add') {
      if (!library.decks.some(deck => deck.id === payload.deck.id)) library.decks.push(structuredClone(payload.deck));
      continue;
    }
    const deck = library.decks.find(item => item.id === payload.deckId);
    if (!deck) continue;
    if (event.type === 'deck.edit') {
      applyFields(deck, payload.fields);
      continue;
    }
    if (event.type === 'card.add') {
      if (!deck.cards.some(card => card.id === payload.card.id)) deck.cards.push(structuredClone(payload.card));
      continue;
    }
    if (event.type === 'card.remove') {
      deck.cards = deck.cards.filter(card => card.id !== payload.cardId);
      continue;
    }
    const card = deck.cards.find(item => item.id === payload.cardId);
    if (!card) continue;
    if (event.type === 'answer' && !reversed.has(event.id)) applyAnswer(deck, card, event);
    if (event.type === 'card.edit') {
      applyFields(card, payload.fields);
      if (payload.resetReview) {
        delete card.review;
        delete card.recallReview;
      }
    }
    if (event.type === 'flag.upsert') upsertFlag(card, structuredClone(payload.flag));
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
