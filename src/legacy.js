"use strict";

const courseDecks = [];
const studyDecks = [];
const conjugationDecks = [];
const sectionStorageKey = "french-flashcards-library-sections";
const currentVersion = 11;
const dayMilliseconds = 24 * 60 * 60 * 1000;
const legacyReviewIntervals = [1, 1, 3, 7, 14, 30, 60];
const reviewIntervals = [1, 7, 14, 30, 60, 60, 60];
const mixSize = 20;
const missedReviewDays = 7;
const mixModes = {
  due: { title: "Spaced review", empty: "No cards are due. Try shuffling these sections." },
  missed: { title: "Missed cards", empty: "No cards to retry from the last " + missedReviewDays + " days." },
  shuffle: { title: "Shuffled review", empty: "These sections have no cards." }
};
const sessionModes = {
  deck: "Deck review",
  shuffled: "Shuffled deck",
  shuffle: "Interleave",
  due: "Spaced review",
  missed: "Missed cards"
};
const practiceLabels = { fr: "Recognition", en: "Recall", exercise: "Exercises" };
const directionLabels = { fr: "French → English", en: "English → French" };
const flagReasons = { context: "Needs context", wording: "Unclear wording", error: "Possible error" };
const $ = id => document.getElementById(id);
const cardLabels = {
  vocabulary: "Vocabulary",
  grammar: "Grammar",
  conjugation: "Conjugation",
  example: "Example"
};

function isText(value, limit) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function validReview(review, version) {
  if (!review || !Number.isInteger(review.step) || review.step < 0 || review.step >= reviewIntervals.length) return false;
  if (validDate(review.dueAt) && validDate(review.reviewedAt)) {
    return Date.parse(review.dueAt) - Date.parse(review.reviewedAt) >= dayMilliseconds;
  }
  if (version >= 9 || typeof review.dueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(review.dueOn)) return false;
  const timestamp = Date.parse(review.dueOn);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === review.dueOn;
}

function validScore(score) {
  return score && Number.isSafeInteger(score.correct) && Number.isSafeInteger(score.attempts) &&
    score.correct >= 0 && score.attempts >= score.correct;
}

function validDate(value) {
  return isText(value, 40) && Number.isFinite(Date.parse(value));
}

function validSession(session, version) {
  return validScore(session) && session.attempts > 0 && isText(session.id, 100) &&
    (session.checkedAt === undefined || validDate(session.checkedAt)) &&
    (session.mode === undefined || Object.hasOwn(sessionModes, session.mode)) &&
    ((version < 8 && session.direction === undefined) || Object.hasOwn(practiceLabels, session.direction));
}

function validFlag(flag) {
  return flag && isText(flag.id, 100) && Object.hasOwn(flagReasons, flag.reason) &&
    Object.hasOwn(practiceLabels, flag.direction) && validDate(flag.flaggedAt) &&
    typeof flag.note === "string" && flag.note.length <= 2000 &&
    isText(flag.original?.fr, 500) && isText(flag.original?.en, 500) &&
    (flag.resolvedAt === undefined || validDate(flag.resolvedAt)) &&
    (flag.revision === undefined || (isText(flag.revision.fr, 500) && isText(flag.revision.en, 500)));
}

function validateBackup(data) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, currentVersion].includes(data?.version) || !Array.isArray(data.decks)) throw new Error("Invalid backup");
  const ids = new Set();
  for (const deck of data.decks) {
    if (!deck || !isText(deck.id, 100) || ids.has(deck.id) ||
        !isText(deck.name, 80) || !isText(deck.category, 80) ||
        !Array.isArray(deck.cards) ||
        (deck.topic !== undefined && !isText(deck.topic, 120)) ||
        (deck.checkedAt !== undefined && !validDate(deck.checkedAt)) ||
        !deck.cards.every(card => card && isText(card.fr, 500) && isText(card.en, 500) &&
          (card.kind === undefined || Object.hasOwn(cardLabels, card.kind)) &&
          (card.review === undefined || validReview(card.review, data.version)) &&
          (card.recallReview === undefined || validReview(card.recallReview, data.version)) &&
          (card.flags === undefined || (Array.isArray(card.flags) && card.flags.every(validFlag)))) ||
        !validScore(deck) ||
        (deck.lastSession !== undefined && (!validScore(deck.lastSession) || !deck.lastSession.attempts)) ||
        (deck.sessions !== undefined && (!Array.isArray(deck.sessions) ||
          !deck.sessions.every(session => validSession(session, data.version))))) {
      throw new Error("Invalid deck");
    }
    ids.add(deck.id);
  }
  return data;
}

function notice(text) {
  $("notice").hidden = !text;
  $("notice").textContent = text;
}

function upgradeReview(review, latestSessionAt) {
  if (!review || review.dueAt) return review;
  const { dueOn, ...progress } = review;
  // Old saves retained a calendar due date, so infer the review day from its interval.
  // Use the end of that day to allow a full interval even after a late-night review.
  const reviewed = new Date(dueOn + "T00:00:00");
  reviewed.setDate(reviewed.getDate() - legacyReviewIntervals[review.step]);
  reviewed.setHours(23, 59, 59, 999);
  // Session times provide a conservative upper bound when cards were practiced early.
  const dueFrom = Math.max(reviewed.getTime(), Date.parse(latestSessionAt) || 0);
  return {
    ...progress,
    reviewedAt: reviewed.toISOString(),
    dueAt: new Date(dueFrom + reviewIntervals[review.step] * dayMilliseconds).toISOString()
  };
}

function upgradeLibrary(library, backfillReviewDates = false) {
  if (library.version === currentVersion) return library;
  let decks = library.decks.filter(deck => deck.id !== "verbs-present-2").map(deck =>
    deck.id === "verbs-present-1" && deck.name === "Top 50 Present Tense · Part 1"
      ? { ...deck, name: "Top 25 Present Tense" } : deck);
  decks = decks.map(deck => deck.category === "Conjugation" ? { ...deck, category: "Verbs" } : deck);
  if (backfillReviewDates && library.version === 3) {
    // The course decks first became available on Nov 12, before review dates were recorded.
    const courseIds = new Set(courseDecks.map(deck => deck.id));
    decks = decks.map(deck => {
      if (deck.attempts > 0 && !deck.checkedAt && courseIds.has(deck.id)) {
        return { ...deck, checkedAt: "2026-11-12" };
      }
      return deck;
    });
  }
  decks = decks.map(deck => {
    const { lastSession, ...rest } = deck;
    const sessions = deck.sessions ?? (lastSession ? [{
      id: "previous-session", checkedAt: deck.checkedAt, correct: lastSession.correct, attempts: lastSession.attempts
    }] : []);
    if (!sessions.length) return deck;
    const direction = deck.cards.length && deck.cards.every(isExercise) ? "exercise" : "fr";
    return { ...rest, sessions: sessions.map(session => ({ direction, ...session })) };
  });
  decks = decks.map(deck => {
    const latestSessionAt = direction => deck.sessions?.find(session => session.direction === direction)?.checkedAt ?? deck.checkedAt;
    return {
      ...deck,
      cards: deck.cards.map(card => ({
        ...card,
        ...(card.review ? { review: upgradeReview(card.review, latestSessionAt(practiceDirection(card, "fr"))) } : {}),
        ...(card.recallReview ? { recallReview: upgradeReview(card.recallReview, latestSessionAt("en")) } : {})
      }))
    };
  });
  const savedIds = new Set(decks.map(deck => deck.id));
  const addedDecks = [];
  if (library.version < 5) addedDecks.push(...studyDecks);
  if (library.version < 6) addedDecks.push(...conjugationDecks);
  return {
    ...library,
    version: currentVersion,
    decks: [...decks, ...addedDecks.filter(deck => !savedIds.has(deck.id))]
  };
}


function isExercise(card) {
  return card.kind === "grammar" || card.kind === "conjugation";
}
function practiceDirection(card, language) {
  return isExercise(card) ? "exercise" : language;
}
export function normalizeLegacy(input) {
  return upgradeLibrary(validateBackup(structuredClone(input)), true);
}
