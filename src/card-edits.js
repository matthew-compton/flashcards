function target(library, { deckId, cardId }) {
  const card = library.decks.find(deck => deck.id === deckId)?.cards.find(card => card.id === cardId);
  if (!card) throw new Error('This card has been removed. Reopen the deck to get the current cards.');
  return card;
}

function sides({ front, back }) {
  const fr = front?.trim();
  const en = back?.trim();
  if (!fr || !en || fr.length > 500 || en.length > 500) {
    throw new Error('Both sides must contain between 1 and 500 characters.');
  }
  return { fr, en };
}

export function rewriteCard(library, reference, replacement, { resetReview = false } = {}) {
  const card = target(library, reference);
  const fields = sides(replacement);
  for (const key of Object.keys(fields)) if (card[key] === fields[key]) delete fields[key];
  if (!Object.keys(fields).length && !resetReview) return [];
  const { deckId, cardId } = reference;
  return [{ type: 'card.edit', payload: { deckId, cardId, fields, resetReview } }];
}

export function upsertFlag(library, reference, flag) {
  target(library, reference);
  return { type: 'flag.upsert', payload: { deckId: reference.deckId, cardId: reference.cardId, flag } };
}

export function resolveFlag(library, reference, flagId, resolvedAt, replacement) {
  const existing = target(library, reference).flags?.find(flag => flag.id === flagId);
  if (!existing) throw new Error('The flag is no longer on this card.');
  const flag = { ...existing };
  if (resolvedAt) flag.resolvedAt = resolvedAt;
  else delete flag.resolvedAt;
  if (replacement) flag.revision = sides(replacement);
  return upsertFlag(library, reference, flag);
}

export function splitCard(library, reference, replacements, { uuid }) {
  if (replacements.length < 2) throw new Error('Add at least two cards to split this card.');
  const original = target(library, reference);
  const [first, ...additional] = replacements.map(sides);
  const operations = rewriteCard(library, reference, replacements[0], { resetReview: true });
  for (const text of additional) {
    operations.push({ type: 'card.add', payload: { deckId: reference.deckId, card: {
      ...text, id: uuid(), ...(original.kind ? { kind: original.kind } : {})
    } } });
  }
  return { operations, preview: [first, ...additional], resetReview: true };
}
