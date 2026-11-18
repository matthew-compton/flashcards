export const DAY = 86_400_000;
export const REVIEW_INTERVALS = [1, 7, 14, 30, 60, 60, 60];
export const MISSED_DAYS = 7;
export const MIX_SIZE = 20;

export function isExercise(card) {
  return card.kind === 'grammar' || card.kind === 'conjugation';
}

export function practiceDirection(card, direction) {
  return isExercise(card) ? 'exercise' : direction;
}

export function reviewField(direction) {
  return direction === 'en' ? 'recallReview' : 'review';
}

// Saved snapshots use fr/en even for decks with other languages.
export function cardText(card, side) {
  return card[side === 'front' ? 'fr' : 'en'];
}

export function firstSide(direction) {
  return direction === 'en' ? 'back' : 'front';
}

export function isDue(review, now) {
  return Boolean(review && Date.parse(review.dueAt) <= Number(now));
}

export function nextReview(previous, correct, at) {
  const now = Date.parse(at);
  let step = 0;
  if (correct) {
    const oldStep = previous?.step ?? 0;
    const advance = oldStep === 0 || Date.parse(previous.dueAt) <= now;
    step = Math.min(oldStep + Number(advance), REVIEW_INTERVALS.length - 1);
  }
  return { step, reviewedAt: at, dueAt: new Date(now + REVIEW_INTERVALS[step] * DAY).toISOString() };
}

export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function reviewBuckets(decks, { mode, direction, sections }, now) {
  const oldestMiss = Number(now) - MISSED_DAYS * DAY;
  const includes = mode === 'missed'
    ? review => review?.step === 0 && Date.parse(review.reviewedAt) >= oldestMiss
    : review => mode === 'shuffle' || isDue(review, now);
  const buckets = [];
  for (const deck of decks) {
    if (!sections.has(deck.category)) continue;
    const cards = [];
    deck.cards.forEach((card, cardIndex) => {
      const review = card[reviewField(practiceDirection(card, direction))];
      if (includes(review)) cards.push({ deckId: deck.id, cardId: card.id, cardIndex, dueAt: review?.dueAt });
    });
    if (cards.length) buckets.push({ deck, cards });
  }
  return buckets;
}

export function selectReview(decks, settings, { now = Date.now(), random = Math.random } = {}) {
  const buckets = shuffled(reviewBuckets(decks, settings, now), random);
  for (const bucket of buckets) {
    bucket.cards = shuffled(bucket.cards, random);
    if (settings.mode === 'due') {
      bucket.cards.sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
    }
  }
  const cards = [];
  let previousDeck;
  while (buckets.length) {
    const otherSection = buckets.findIndex(({ deck }) => deck.category !== previousDeck?.category);
    const otherDeck = buckets.findIndex(({ deck }) => deck !== previousDeck);
    const index = otherSection >= 0 ? otherSection : Math.max(otherDeck, 0);
    const [bucket] = buckets.splice(index, 1);
    cards.push(bucket.cards.pop());
    if (bucket.cards.length) buckets.push(bucket);
    previousDeck = bucket.deck;
  }
  return cards;
}
