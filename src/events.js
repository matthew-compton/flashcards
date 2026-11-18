import { validateBackup } from './legacy.js';

export const EVENT_VERSION = 1;
const directions = new Set(['fr', 'en', 'exercise']);
const modes = new Set(['deck', 'shuffled', 'shuffle', 'due', 'missed']);
const kinds = new Set(['vocabulary', 'example', 'grammar', 'conjugation']);
const text = (value, max = 100) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const date = value => text(value, 40) && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) && Number.isFinite(Date.parse(value));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const card = value => object(value) && text(value.id) && text(value.fr, 500) && text(value.en, 500)
  && (value.kind === undefined || kinds.has(value.kind));
const snapshot = value => object(value) && text(value.fr, 500) && text(value.en, 500);
const flag = value => object(value) && text(value.id) && directions.has(value.direction)
  && ['context', 'wording', 'error'].includes(value.reason) && date(value.flaggedAt)
  && typeof value.note === 'string' && value.note.length <= 2000 && snapshot(value.original)
  && (value.resolvedAt === undefined || date(value.resolvedAt))
  && (value.revision === undefined || snapshot(value.revision));

const deckFields = { name: value => text(value, 80), category: value => text(value, 80),
  topic: value => value === null || text(value, 120),
  frontLanguage: value => value === null || text(value, 80), backLanguage: value => value === null || text(value, 80) };
const cardFields = { fr: value => text(value, 500), en: value => text(value, 500),
  kind: value => value === null || kinds.has(value) };

function fields(value, checks) {
  return object(value) && Object.entries(value).every(([key, item]) => Object.hasOwn(checks, key) && checks[key](item));
}

const needsCard = value => text(value.deckId) && text(value.cardId);
const checks = {
  'library.initialize': libraryPayload,
  'library.replace': libraryPayload,
  answer: value => needsCard(value) && typeof value.correct === 'boolean' && directions.has(value.direction)
    && text(value.sessionId) && modes.has(value.mode),
  'answer.undo': value => uuid(value.answerId),
  'deck.add': value => object(value.deck) && Array.isArray(value.deck.cards) && value.deck.cards.every(card)
    && Boolean(validateBackup({ version: 11, decks: [value.deck] })),
  'deck.edit': value => text(value.deckId) && fields(value.fields, deckFields),
  'card.add': value => text(value.deckId) && card(value.card),
  'card.edit': value => needsCard(value) && fields(value.fields, cardFields)
    && (value.resetReview === undefined || typeof value.resetReview === 'boolean'),
  'card.remove': needsCard,
  'flag.upsert': value => needsCard(value) && flag(value.flag)
};

function libraryPayload(value) {
  return (value.sourceHash === undefined || /^[a-f0-9]{64}$/.test(value.sourceHash))
    && Boolean(validateBackup(value.library));
}

export function validateEvent(event) {
  const okay = object(event) && (event.schemaVersion === undefined || event.schemaVersion === EVENT_VERSION)
    && uuid(event.id) && uuid(event.generation) && date(event.at)
    && (!event.type?.startsWith?.('library.') || event.id === event.generation)
    && object(event.payload) && Object.hasOwn(checks, event.type) && checks[event.type](event.payload);
  if (!okay) throw new Error('A study record is invalid or requires a newer version of Flashcards.');
  return event;
}

export function validateSyncPage(page, after) {
  if (!object(page) || !Array.isArray(page.events) || typeof page.hasMore !== 'boolean'
      || page.events.some((row, index) => row?.revision !== after + index + 1)) {
    throw new Error('The sync response was incomplete. Your local progress is saved.');
  }
  for (const { event } of page.events) validateEvent(event);
  return page;
}
