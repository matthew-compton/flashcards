import { prepareLibrary } from "./model.js";

export const CARD_UPDATE_FORMAT = "flashcards-card-updates";

const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const snapshot = value => text(value?.fr, 500) && text(value?.en, 500);
const sameText = (left, right) => left.fr === right.fr && left.en === right.en;

export function readCardUpdates(file) {
  if (file.version !== 1 || !Array.isArray(file.decks) || !file.decks.length) {
    throw new Error("That file is not a valid Flashcards card update.");
  }
  const seen = new Set();
  return file.decks.map(update => {
    if (!text(update?.id, 100) || seen.has(update.id) || !Array.isArray(update.add) || !Array.isArray(update.revise)) {
      throw new Error("That file is not a valid Flashcards card update.");
    }
    seen.add(update.id);
    const additions = update.add.map(row => {
      if (!text(row?.id, 100)) throw new Error("Every imported card must have an identifier.");
      return { id: row.id, fr: row.fr, en: row.en, kind: row.kind };
    });
    const [deck] = prepareLibrary({ version: 11, decks: [{
      id: update.id, name: update.id.slice(0, 80), category: "Import", attempts: 0, correct: 0, cards: additions
    }] }).decks;
    const cardIds = new Set(deck.cards.map(c => c.id));
    for (const change of update.revise) {
      if (!text(change?.id, 100) || !snapshot(change.from) || !snapshot(change.to) || cardIds.has(change.id)) {
        throw new Error("That file contains an invalid or repeated card correction.");
      }
      cardIds.add(change.id);
    }
    return { id: update.id, add: deck.cards, revise: update.revise };
  });
}

export function planCardUpdates(updates, library) {
  const byId = new Map(library.decks.map(deck => [deck.id, deck]));
  const operations = [];
  const targets = [];
  let added = 0;
  let corrected = 0;
  for (const update of updates) {
    const deck = byId.get(update.id);
    if (!deck) throw new Error("The library is missing a deck required by this update.");
    const cards = new Map(deck.cards.map(card => [card.id, card]));
    let addCount = 0;
    let correctionCount = 0;
    for (const card of update.add) {
      const current = cards.get(card.id);
      if (current) {
        if (!sameText(current, card) || current.kind !== card.kind) {
          throw new Error("An imported card conflicts with an existing card in " + deck.name + ".");
        }
        continue;
      }
      operations.push({ type: "card.add", payload: { deckId: deck.id, card } });
      addCount++;
    }
    for (const change of update.revise) {
      const current = cards.get(change.id);
      if (!current || (!sameText(current, change.from) && !sameText(current, change.to))) {
        throw new Error("A card in " + deck.name + " changed since the update was prepared.");
      }
      if (sameText(current, change.to)) continue;
      const fields = { fr: change.to.fr, en: change.to.en };
      operations.push({ type: "card.edit", payload: { deckId: deck.id, cardId: current.id, fields } });
      correctionCount++;
    }
    if (addCount || correctionCount) {
      targets.push({ name: deck.name, addCount, correctionCount });
      added += addCount;
      corrected += correctionCount;
    }
  }
  return { operations, targets, added, corrected };
}
