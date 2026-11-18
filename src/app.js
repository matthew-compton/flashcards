import { prepareLibrary } from "./model.js";
import { startCloud } from "./cloud.js";
import { bindCardSwipe } from "./swipe.js";
"use strict";

const storageKey = "french-flashcards-course-v3";
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
const directionLabels = { fr: "Front → Back", en: "Back → Front" };
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function languageName(code) {
  try { return languageNames.of(code) ?? code; }
  catch { return code; }
}

function cardLanguage(deck, side) {
  return side === 'fr' ? deck?.frontLanguage ?? 'fr' : deck?.backLanguage ?? 'en';
}

function directionName(direction, deck) {
  if (direction === 'exercise') return;
  if (!deck) return directionLabels[direction];
  const first = direction === 'fr' ? 'fr' : 'en';
  const last = first === 'fr' ? 'en' : 'fr';
  return languageName(cardLanguage(deck, first)) + ' → ' + languageName(cardLanguage(deck, last));
}
const flagReasons = { context: "Needs context", wording: "Unclear wording", error: "Possible error" };
const $ = id => document.getElementById(id);
const cardLabels = {
  vocabulary: "Vocabulary",
  grammar: "Grammar",
  conjugation: "Conjugation",
  example: "Example"
};

let data = { version: currentVersion, decks: [] };
let studyStore;
let saving = false;
let lastSavedAnswerId;

function notice(message) {
  $("notice").hidden = !message;
  $("notice").textContent = message;
}

async function save(next) {
  if (!studyStore) return false;
  try {
    if (!studyStore.generation) await studyStore.importLibrary(next);
    else await studyStore.saveLibrary(data, next);
    data = studyStore.library;
    return true;
  } catch (error) { notice(error.message); return false; }
}
let deckId = data.decks[0]?.id;
let editingId;
let editingOriginal;
let front = "fr";
let round;
let mixSettings;
let nextReviewRefresh = Infinity;
let reportingEntry;
let fixingEntry;

function cardFor(entry) {
  const deck = findDeck(entry.deckId);
  if (!deck) return;
  if (entry.cardId) entry.cardIndex = deck.cards.findIndex(card => card.id === entry.cardId);
  return deck.cards[entry.cardIndex];
}

function findDeck(id = deckId) {
  return data.decks.find(deck => deck.id === id);
}

function isExercise(card) {
  return card.kind === "grammar" || card.kind === "conjugation";
}

function practiceDirection(card, language) {
  return isExercise(card) ? "exercise" : language;
}

function reviewField(direction) {
  // Older reviews were always French-first or fixed prompt exercises.
  return direction === "en" ? "recallReview" : "review";
}

function isDue(review, now) {
  return Boolean(review && Date.parse(review.dueAt) <= now.getTime());
}

function scorePercent({ correct, attempts }) {
  return Math.round(100 * correct / attempts);
}

function rate(score) {
  return score?.attempts ? scorePercent(score) + "%" : "—";
}

const checkedDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const historyDateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const historyTimeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function formatStudyDate(value, dateFormat, dateTimeFormat = dateFormat) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? value + "T00:00:00" : value);
  return (dateOnly ? dateFormat : dateTimeFormat).format(date);
}

function studyDate(value, dateFormat, dateTimeFormat) {
  const time = make("time", "", formatStudyDate(value, dateFormat, dateTimeFormat));
  time.dateTime = value;
  return time;
}

function showCheckedDate(element, deck) {
  element.hidden = !deck?.attempts;
  const checkedAt = deck?.checkedAt;
  if (!checkedAt) {
    element.textContent = element.hidden ? "" : "No date recorded";
    return;
  }
  const date = studyDate(checkedAt, checkedDateFormat);
  date.title = "Last checked";
  element.replaceChildren(date);
}

function plotElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function renderHistoryTrend(sessions) {
  $("history-trend").hidden = sessions.length === 0;
  $("trend-points").replaceChildren();
  if (!sessions.length) return;

  const series = [...sessions].reverse();
  const first = series[0];
  const latest = series.at(-1);
  const intervals = series.length - 1;
  let summary = "Latest " + rate(latest);
  if (intervals) {
    const change = scorePercent(latest) - scorePercent(first);
    if (change) summary += " · " + (change > 0 ? "+" : "−") + Math.abs(change) + " percentage points since first session";
    else summary += " · Same score as first session";
  }
  $("trend-summary").textContent = summary;
  $("trend-first").textContent = first.checkedAt
    ? (intervals ? "First · " : "") + formatStudyDate(first.checkedAt, historyDateFormat)
    : "First session";
  $("trend-last").hidden = intervals === 0;
  $("trend-last").textContent = latest.checkedAt
    ? "Latest · " + formatStudyDate(latest.checkedAt, historyDateFormat)
    : "Latest session";

  const points = series.map((session, index) => ({
    x: intervals ? 52 + 418 * index / intervals : 261,
    y: 137 - 124 * scorePercent(session) / 100
  }));
  const plot = $("trend-points");
  if (intervals) {
    plot.append(plotElement("polyline", {
      class: "trend-line",
      points: points.map(({ x, y }) => x + "," + y).join(" ")
    }));
  }
  points.forEach(({ x, y }, index) => {
    const dot = plotElement("circle", { class: "trend-point", cx: x, cy: y, r: index === intervals ? 5.5 : 4 });
    const session = series[index];
    const title = plotElement("title");
    const date = session.checkedAt
      ? formatStudyDate(session.checkedAt, historyDateFormat, historyTimeFormat)
      : "Session " + (index + 1);
    title.textContent = date + " · " + rate(session) + " · " + session.correct + " of " + session.attempts + " correct";
    dot.append(title);
    plot.append(dot);
  });
}

function deckPracticeModes(deck) {
  const modes = new Set(deck.sessions?.map(session => session.direction));
  for (const card of deck.cards) {
    if (isExercise(card)) modes.add("exercise");
    else {
      modes.add("fr");
      modes.add("en");
    }
  }
  return Object.keys(practiceLabels).filter(mode => modes.has(mode));
}

function latestScores(deck) {
  return Object.fromEntries(deckPracticeModes(deck).map(direction => [
    direction,
    deck.sessions?.find(session => session.direction === direction)
  ]));
}

function renderHistory(deck, direction) {
  const sessions = deck.sessions?.filter(session => session.direction === direction) ?? [];
  const rows = sessions.map(session => {
    const row = make("li", "", "");
    const details = make("div", "", "");
    details.append(session.checkedAt
      ? studyDate(session.checkedAt, historyDateFormat, historyTimeFormat)
      : make("span", "muted", "Date unavailable"));
    if (session.mode) details.append(make("small", "", sessionModes[session.mode]));
    const score = make("div", "", "");
    score.append(make("strong", "", rate(session)), make("small", "", session.correct + " of " + session.attempts + " correct"));
    row.append(details, score);
    return row;
  });
  $("history-empty").hidden = sessions.length > 0;
  renderHistoryTrend(sessions);
  $("history-list").replaceChildren(...rows);
}

function openHistory() {
  const deck = findDeck();
  if (!deck) return;
  const modes = deckPracticeModes(deck);
  const controls = $("history-directions");
  const selected = deck.sessions?.[0]?.direction ?? modes[0];
  const buttons = modes.map(direction => {
    const button = make("button", "button", practiceLabels[direction]);
    button.type = "button";
    button.title = directionName(direction, deck) ?? "Fixed question and answer cards";
    button.setAttribute("aria-pressed", String(direction === selected));
    button.onclick = () => {
      for (const other of controls.children) other.setAttribute("aria-pressed", String(other === button));
      renderHistory(deck, direction);
    };
    return button;
  });
  controls.replaceChildren(...buttons);
  $("history-deck").textContent = deck.name;
  renderHistory(deck, selected);
  const dialog = $("history-dialog");
  dialog.showModal();
  dialog.scrollTop = 0;
}

function categories() {
  const groups = new Map();
  for (const deck of data.decks) {
    const group = groups.get(deck.category) ?? { decks: [], correct: 0, attempts: 0 };
    group.decks.push(deck);
    group.correct += deck.correct;
    group.attempts += deck.attempts;
    groups.set(deck.category, group);
  }
  return groups;
}

function make(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

async function saveCardUpdate(entry, updated) {
  const decks = data.decks.map(deck => {
    if (deck.id !== entry.deckId) return deck;
    const cards = deck.cards.map((card, index) => index === entry.cardIndex ? updated : card);
    return { ...deck, cards };
  });
  return save({ ...data, decks });
}

function refreshFlagCount() {
  const count = data.decks.reduce((total, deck) => total + deck.cards.reduce((sum, card) =>
    sum + (card.flags?.filter(flag => !flag.resolvedAt).length ?? 0), 0), 0);
  $("open-flags").textContent = "Flagged cards" + (count ? " (" + count + ")" : "");
}

function flagError(id, message = "") {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function openCardFlag() {
  const entry = round.cards[round.index];
  if (!entry) return;
  const card = cardFor(entry);
  const direction = practiceDirection(card, front);
  const existing = card.flags?.find(flag => !flag.resolvedAt && flag.direction === direction);
  reportingEntry = { ...entry, direction, flagId: existing?.id, original: { fr: card.fr, en: card.en } };
  $("flag-reason").value = existing?.reason ?? "context";
  $("flag-note").value = existing?.note ?? "";
  flagError("flag-error");
  $("flag-dialog").showModal();
}

function openFlagFix(entry, flagId) {
  const card = cardFor(entry);
  fixingEntry = { ...entry, flagId };
  $("fix-front").value = card.fr;
  $("fix-back").value = card.en;
  const deck = findDeck(entry.deckId);
  $("fix-front-label").firstChild.textContent = isExercise(card) ? "Question" : languageName(cardLanguage(deck, 'fr'));
  $("fix-back-label").firstChild.textContent = isExercise(card) ? "Answer" : languageName(cardLanguage(deck, 'en'));
  $("fix-reset").checked = true;
  flagError("fix-error");
  $("fix-dialog").showModal();
}

async function setFlagResolved(entry, flagId, resolved) {
  const card = cardFor(entry);
  const flags = card.flags.map(flag => flag.id === flagId
    ? { ...flag, resolvedAt: resolved ? new Date().toISOString() : undefined } : flag);
  if (!await saveCardUpdate(entry, { ...card, flags })) {
    flagError("flags-error", "The flag could not be saved. Allow browser storage, then try again.");
    return;
  }
  render();
  renderFlagList();
}

function renderFlagList() {
  const entries = data.decks.flatMap(deck => deck.cards.flatMap((card, cardIndex) =>
    (card.flags ?? []).map(flag => ({ deck, cardIndex, flag }))));
  const shown = entries.filter(({ flag }) => $("include-resolved").checked || !flag.resolvedAt);
  shown.sort((a, b) => Date.parse(b.flag.flaggedAt) - Date.parse(a.flag.flaggedAt));
  const rows = shown.map(({ deck, cardIndex, flag }) => {
    const entry = { deckId: deck.id, cardIndex, cardId: deck.cards[cardIndex].id };
    const row = make("article", "flag-item", "");
    row.append(make("h3", "", deck.category + " · " + deck.name));
    const direction = directionName(flag.direction, deck) ?? practiceLabels[flag.direction];
    row.append(make("p", "muted", flagReasons[flag.reason] + " · " + direction +
      " · " + formatStudyDate(flag.flaggedAt, historyDateFormat, historyTimeFormat)));
    if (flag.note) row.append(make("p", "", flag.note));
    const original = make("dl", "", "");
    const snapshotLabels = isExercise(deck.cards[cardIndex]) ? ["Original question", "Original answer"] : ["Original " + languageName(cardLanguage(deck, 'fr')), "Original " + languageName(cardLanguage(deck, 'en'))];
    original.append(make("dt", "", snapshotLabels[0]), make("dd", "", flag.original.fr),
      make("dt", "", snapshotLabels[1]), make("dd", "", flag.original.en));
    row.append(original);
    const actions = make("div", "actions", "");
    if (flag.resolvedAt) {
      row.append(make("p", "muted", "Resolved " + formatStudyDate(flag.resolvedAt, historyDateFormat, historyTimeFormat)));
      if (flag.revision) {
        const revision = make("dl", "", "");
        revision.append(make("dt", "", "Revised card"), make("dd", "", flag.revision.fr), make("dd", "", flag.revision.en));
        row.append(revision);
      }
      const reopen = make("button", "button", "Reopen flag");
      reopen.onclick = () => setFlagResolved(entry, flag.id, false);
      actions.append(reopen);
    } else {
      const edit = make("button", "button", "Improve card");
      edit.onclick = () => openFlagFix(entry, flag.id);
      const resolve = make("button", "button", "Resolve flag");
      resolve.onclick = () => setFlagResolved(entry, flag.id, true);
      actions.append(edit, resolve);
    }
    row.append(actions);
    return row;
  });
  $("flags-list").replaceChildren(...rows);
  $("flags-empty").hidden = shown.length > 0;
}

const expandedSections = new Map();
try {
  const saved = JSON.parse(localStorage.getItem(sectionStorageKey) ?? "{}");
  for (const [name, expanded] of Object.entries(saved ?? {})) {
    if (typeof expanded === "boolean") expandedSections.set(name, expanded);
  }
} catch {
  // Section preferences are optional when browser storage is unavailable.
}

function renderLibrary(groups) {
  const selected = document.activeElement?.dataset;
  const now = new Date();
  if (round.mix) $("open-mix").setAttribute("aria-current", "true");
  else $("open-mix").removeAttribute("aria-current");
  $("library").replaceChildren();
  for (const [name, group] of groups) {
    const section = make("details", "category", "");
    const heading = make("summary", "category-heading", "");
    heading.dataset.category = name;
    heading.append(make("h3", "", name));
    section.append(heading);
    if (!expandedSections.has(name)) expandedSections.set(name, findDeck()?.category === name);
    section.open = expandedSections.get(name);
    section.addEventListener("toggle", () => {
      if (!section.isConnected || expandedSections.get(name) === section.open) return;
      expandedSections.set(name, section.open);
      try {
        localStorage.setItem(sectionStorageKey, JSON.stringify(Object.fromEntries(expandedSections)));
      } catch {
        // Keep the current open sections in memory if saving fails.
      }
    });
    let groupDue = 0;
    for (const deck of group.decks) {
      const button = make("button", "deck", "");
      button.type = "button";
      button.dataset.deck = deck.id;
      if (!round.mix && deck.id === deckId) button.setAttribute("aria-current", "true");
      const label = make("span", "deck-name", deck.name);
      const cardCount = deck.cards.length + (deck.cards.length === 1 ? " card" : " cards");
      label.append(make("span", "deck-details", deck.topic ? deck.topic + " · " + cardCount : cardCount));
      const due = deck.cards.reduce((count, card) =>
        count + Number(isDue(card.review, now)) + Number(!isExercise(card) && isDue(card.recallReview, now)), 0);
      if (due) {
        groupDue += due;
        button.classList.add("has-due");
        label.append(make("span", "due-count", due + " due"));
      }
      const score = make("span", "deck-score", "");
      const checked = make("small", "checked-date", "");
      showCheckedDate(checked, deck);
      const latest = latestScores(deck);
      const modes = Object.hasOwn(latest, "fr") || Object.hasOwn(latest, "en") ? ["fr", "en"] : ["exercise"];
      const sessionRate = make("span", "deck-rate", modes.map(mode => rate(latest[mode])).join(" / "));
      sessionRate.title = modes.map(mode => practiceLabels[mode] + " " + rate(latest[mode])).join(" · ");
      button.setAttribute("aria-description", sessionRate.title);
      score.append(sessionRate, checked);
      button.append(label, score);
      button.addEventListener("click", () => {
        $("mobile-decks").close();
        if (!round.mix && deckId === deck.id) return;
        deckId = deck.id;
        startRound();
        $("card").focus();
      });
      section.append(button);
    }
    heading.append(make("span", "category-rate", rate(group)));
    if (groupDue) heading.append(make("span", "due-count", groupDue + " due"));
    $("library").append(section);
  }
  if (selected?.deck || selected?.category) {
    Array.from($("library").querySelectorAll("[data-deck], [data-category]")).find(element =>
      (selected.deck && element.dataset.deck === selected.deck) ||
      (selected.category && element.dataset.category === selected.category)
    )?.focus();
  }
  nextReviewRefresh = data.decks.flatMap(deck => deck.cards.flatMap(card => [
    card.review?.dueAt, !isExercise(card) ? card.recallReview?.dueAt : undefined
  ])).reduce((earliest, dueAt) => {
    const timestamp = Date.parse(dueAt);
    return timestamp > now.getTime() ? Math.min(earliest, timestamp) : earliest;
  }, Infinity);
}

function shuffleItems(items) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function beginRound(cards, { shuffle = false, mix = null } = {}) {
  cards = cards.map(entry => ({ ...entry, cardId: entry.cardId ?? cardFor(entry)?.id }));
  round = { id: crypto.randomUUID(), cards, index: 0, correct: 0, revealed: false, graded: false, shuffle, mix, lastGrade: null };
  render();
}

function startRound(shuffle = false) {
  const deck = findDeck();
  const cards = deck?.cards.map((_, cardIndex) => ({ deckId: deck.id, cardIndex })) ?? [];
  beginRound(shuffle ? shuffleItems(cards) : cards, { shuffle });
}

function mixSelection() {
  const form = new FormData($("mix-form"));
  const sections = new Set(form.getAll("mix-section"));
  return { mode: form.get("mix-mode"), direction: form.get("mix-direction"), sections };
}

function mixBuckets({ mode, direction, sections }) {
  const now = new Date();
  const oldestMiss = now.getTime() - missedReviewDays * dayMilliseconds;
  const includes = mode === "missed"
    ? review => review?.step === 0 && Date.parse(review.reviewedAt) >= oldestMiss
    : review => mode === "shuffle" || isDue(review, now);
  const buckets = [];
  for (const deck of data.decks) {
    if (!sections.has(deck.category)) continue;
    const cards = [];
    deck.cards.forEach((card, cardIndex) => {
      const review = card[reviewField(practiceDirection(card, direction))];
      if (includes(review)) cards.push({ deckId: deck.id, cardIndex, dueAt: review?.dueAt });
    });
    if (cards.length) buckets.push({ deck, cards });
  }
  return buckets;
}

function updateMixStatus() {
  const settings = mixSelection();
  const count = mixBuckets(settings).reduce((total, bucket) => total + bucket.cards.length, 0);
  const size = settings.mode === "missed" ? count : Math.min(count, mixSize);
  $("start-mix").disabled = !size;
  let status = size + (size === 1 ? " card in this review" : " cards in this review");
  if (!settings.sections.size) status = "Select at least one section.";
  else if (!size) status = mixModes[settings.mode].empty;
  else if (settings.mode === "missed") status = size + (size === 1 ? " card" : " cards") + " to retry from the last " + missedReviewDays + " days";
  $("mix-status").textContent = status;
}

function openMix() {
  const sections = Array.from(categories().keys());
  const selected = mixSettings?.sections ?? new Set(sections);
  const labels = sections.map(section => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "mix-section";
    checkbox.value = section;
    checkbox.checked = selected.has(section);
    const label = document.createElement("label");
    label.append(checkbox, make("span", "", section));
    return label;
  });
  $("mix-sections").replaceChildren(...labels);
  $("mix-form").elements["mix-mode"].value = mixSettings?.mode ?? "due";
  $("mix-form").elements["mix-direction"].value = front;
  updateMixStatus();
  $("mix-dialog").showModal();
}

function interleave(settings) {
  const buckets = shuffleItems(mixBuckets(settings));
  for (const { cards } of buckets) {
    shuffleItems(cards);
    if (settings.mode === "due") {
      // Pop the longest-overdue card from each deck first. Shuffling breaks ties.
      cards.sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
    }
  }
  const cards = [];
  let previousDeck;
  while (buckets.length && (settings.mode === "missed" || cards.length < mixSize)) {
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

function showMessage(title, detail, button, action) {
  $("message-title").textContent = title;
  $("message-detail").textContent = detail;
  $("message-action").textContent = button;
  $("message-action").onclick = action;
}

function render() {
  cancelSwipe();
  refreshFlagCount();
  const groups = categories();
  renderLibrary(groups);
  const mix = round.mix;
  const deck = mix ? null : findDeck();
  $("deck-title").textContent = mix ? "Interleave your decks" : deck?.name ?? "Your flashcards";
  $("category-name").textContent = mix ? mixModes[mix].title : [deck?.category, deck?.topic].filter(Boolean).join(" · ");
  $("study-actions").hidden = !deck && !mix;
  $("shuffle").hidden = $("edit-deck").hidden = Boolean(mix);
  $("open-history").hidden = !deck;
  $("stats").hidden = !deck;
  showCheckedDate($("deck-checked"), deck);
  if (deck) {
    const group = groups.get(deck.category);
    $("category-rate").textContent = rate(group);
    $("category-attempts").textContent = group.attempts ? group.correct + " of " + group.attempts + " correct" : "No score yet";
    const scores = Object.entries(latestScores(deck)).map(([mode, session]) => {
      const block = make("div", "", "");
      const label = make("dt", "", practiceLabels[mode]);
      label.title = directionName(mode, deck) ?? "Fixed question and answer cards";
      const value = make("dd", "", "");
      value.append(make("strong", "", rate(session)));
      value.append(make("small", "", session ? session.correct + " of " + session.attempts + " correct" : "No score yet"));
      block.append(label, value);
      return block;
    });
    $("deck-session-scores").replaceChildren(...scores);
  }
  const total = round.cards.length;
  const finished = total > 0 && round.index === total;
  $("direction").textContent = directionName(front, deck);
  $("direction").hidden = Boolean(deck && !deck.cards.some(card => !isExercise(card)));
  $("direction").disabled = mix === "due" || mix === "missed";
  $("direction").title = $("direction").disabled ? "Direction selected when starting this review" : "Change the language order for vocabulary and examples";
  $("shuffle").disabled = total < 2;
  $("undo-actions").hidden = !total;
  $("undo").disabled = round.lastGrade === null;
  $("skip").hidden = finished;
  $("flag-card").hidden = finished;
  $("review").hidden = !total || finished;
  $("message").hidden = total > 0 && !finished;
  if (finished) {
    const summary = round.correct + " of " + total + " correct · " + rate({ correct: round.correct, attempts: total });
    if (mix) {
      showMessage("Round complete", summary, "Start another mix", openMix);
    } else {
      showMessage("Round complete", summary, "Study again", () => {
        startRound(round.shuffle);
        $("card").focus();
      });
    }
  } else if (!total && !deck) {
    showMessage("Bring your progress here", "In your original app, choose Export backup. Import that file here once to transfer your decks, scores, history, flags, and schedules to your account.", "Import existing library", () => $("backup-file").click());
  } else if (!total) {
    showMessage("This deck is empty", "Add a card to start studying.", "Edit deck", () => openEditor(deck));
  } else {
    renderCard();
  }
}

function renderCard() {
  cancelSwipe();
  const entry = round.cards[round.index];
  const deck = findDeck(entry.deckId);
  const card = cardFor(entry);
  const flagged = card.flags?.some(flag => !flag.resolvedAt && flag.direction === practiceDirection(card, front));
  $("flag-card").textContent = flagged ? "Flagged" : "Flag card";
  $("flag-card").classList.toggle("flagged", Boolean(flagged));
  $("card-source").hidden = !round.mix;
  $("card-source").textContent = round.mix ? deck.category + " · " + deck.name : "";
  const question = isExercise(card);
  const firstSide = question ? "fr" : front;
  const side = round.revealed ? (firstSide === "fr" ? "en" : "fr") : firstSide;
  const sideLabel = question ? (round.revealed ? "Answer" : "Question") : languageName(cardLanguage(deck, side));
  const typeLabel = cardLabels[card.kind];
  $("card-language").textContent = typeLabel ? typeLabel + " · " + sideLabel : sideLabel;
  $("term").lang = card.kind === "grammar" ? "en" : cardLanguage(deck, side);
  if (round.mix) $("direction").textContent = directionName(front, deck);
  $("term").textContent = card[side];
  $("card").classList.toggle("long-card", question || card[side].length > 70);
  $("card").classList.toggle("revealed", round.revealed);
  $("mobile-flip-hint").textContent = round.revealed ? "Swipe or tap a grade" : "Tap to reveal";
  $("position").textContent = "Card " + (round.index + 1) + " of " + round.cards.length;
  $("round-score").textContent = round.correct + " correct this round";
  $("progress").max = round.cards.length;
  $("progress").value = round.index;
  $("incorrect").disabled = !round.graded;
  $("correct").disabled = !round.graded;
  $("skip").disabled = round.index >= round.cards.length - 1;
}

function flip() {
  if (saving) return;
  round.revealed = !round.revealed;
  if (round.revealed) round.graded = true;
  renderCard();
}

function skipCard() {
  if (saving) return;
  if (round.index >= round.cards.length - 1) return;
  const [entry] = round.cards.splice(round.index, 1);
  round.cards.push(entry);
  round.revealed = false;
  round.graded = false;
  renderCard();
  $("card").focus();
}

async function saveScoreChange(deck, cardIndex, correct, delta, direction) {
  try {
    const card = deck.cards[cardIndex];
    const operations = delta > 0 ? [{ type: 'answer', payload: {
      deckId: deck.id, cardId: card.id, direction, correct, sessionId: round.id,
      mode: round.mix ?? (round.shuffle ? 'shuffled' : 'deck')
    } }] : [{ type: 'answer.undo', payload: { answerId: round.lastGrade.eventId } }];
    const events = await studyStore.commit(operations);
    if (delta > 0) lastSavedAnswerId = events[0].id;
    data = studyStore.library;
    return true;
  } catch (error) { notice(error.message); return false; }
}
async function grade(correct) {
  if (saving) return;
  const entry = round.cards[round.index];
  if (!entry || !round.graded) return;
  const deck = findDeck(entry.deckId);
  const card = cardFor(entry);
  if (!card) return;
  saving = true;
  const direction = practiceDirection(card, front);
  if (!await saveScoreChange(deck, entry.cardIndex, correct, 1, direction)) {
    saving = false;
    notice("Your answer could not be saved. Allow browser storage, then try again.");
    return;
  }
  saving = false;
  notice("");
  round.index++;
  round.correct += Number(correct);
  round.lastGrade = {
    correct, direction, eventId: lastSavedAnswerId
  };
  round.revealed = false;
  round.graded = false;
  render();
  $(round.index === round.cards.length ? "message-action" : "card").focus();
}

async function undoGrade() {
  if (saving) return;
  const lastGrade = round.lastGrade;
  if (!lastGrade) return;
  const entry = round.cards[round.index - 1];
  const deck = findDeck(entry.deckId);
  const { correct, direction } = lastGrade;
  cardFor(entry);
  saving = true;
  if (!await saveScoreChange(deck, entry.cardIndex, correct, -1, direction)) {
    saving = false;
    notice("Undo could not be saved. Allow browser storage, then try again.");
    return;
  }
  saving = false;
  notice("");
  round.index--;
  round.correct -= Number(correct);
  round.lastGrade = null;
  if (direction !== "exercise") front = direction;
  round.revealed = true;
  round.graded = true;
  render();
  $("card").focus();
}

const originalCards = new WeakMap();

function addCardFields(card = { fr: "", en: "" }, focus = false) {
  const row = make("div", "card-edit", "");
  originalCards.set(row, card);
  if (card.kind) row.dataset.kind = card.kind;
  const question = isExercise(card);
  const labels = question ? [["fr", "Question"], ["en", "Answer"]] : [
    ["fr", languageName($("front-language").value || "fr")],
    ["en", languageName($("back-language").value || "en")]
  ];
  for (const [key, label] of labels) {
    const field = make("label", "field", label);
    const input = document.createElement("input");
    input.name = key;
    input.value = card[key];
    input.maxLength = 500;
    input.lang = card.kind === "grammar" ? "en" : key === "fr" ? $("front-language").value : $("back-language").value;
    field.append(input);
    row.append(field);
  }
  const remove = make("button", "button remove", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => {
    row.remove();
    $("add-card").focus();
  });
  row.append(remove);
  $("card-fields").append(row);
  if (focus) row.querySelector("input").focus();
}

function openEditor(deck) {
  editingId = deck?.id;
  editingOriginal = deck ? structuredClone(deck) : null;
  $("editor-title").textContent = deck ? "Edit deck" : "New deck";
  $("deck-input").value = deck?.name ?? "";
  $("category-input").value = deck?.category ?? "";
  $("front-language").value = deck?.frontLanguage ?? "fr";
  $("back-language").value = deck?.backLanguage ?? "en";
  $("category-options").replaceChildren(...Array.from(categories().keys(), name => new Option(name, name)));
  $("card-fields").replaceChildren();
  $("editor-error").hidden = true;
  if (deck?.cards.length) deck.cards.forEach(card => addCardFields(card));
  else addCardFields();
  $("editor").showModal();
}

function editorError(text) {
  $("editor-error").textContent = text;
  $("editor-error").hidden = false;
}

$("deck-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("deck-input").value.trim();
  const categoryInput = $("category-input").value.trim();
  const frontLanguage = $("front-language").value.trim();
  const backLanguage = $("back-language").value.trim();
  try {
    Intl.getCanonicalLocales([frontLanguage, backLanguage]);
  } catch { return editorError("Enter valid language codes, such as fr, en, de, or es."); }
  if (!name || !categoryInput) return editorError("Enter a deck name and category.");
  const category = Array.from(categories().keys()).find(item => item.toLowerCase() === categoryInput.toLowerCase()) ?? categoryInput;
  const old = data.decks.find(deck => deck.id === editingId);
  const cards = Array.from($("card-fields").children, row => {
    const card = {
      fr: row.querySelector('[name="fr"]').value.trim(),
      en: row.querySelector('[name="en"]').value.trim(),
      ...(row.dataset.kind ? { kind: row.dataset.kind } : {})
    };
    const original = originalCards.get(row);
    if (original?.id) card.id = original.id;
    const live = old?.cards.find(item => item.id === original?.id);
    if (live?.flags) card.flags = live.flags;
    if (original && live) {
      const changed = card.fr !== original.fr.trim() || card.en !== original.en.trim();
      if (card.fr === original.fr.trim()) card.fr = live.fr;
      if (card.en === original.en.trim()) card.en = live.en;
      if (!changed) {
        card.review = live.review;
        card.recallReview = live.recallReview;
      }
    }
    return card;
  }).filter(card => card.fr || card.en);
  if (cards.some(card => !card.fr || !card.en)) return editorError("Fill in both sides of each card.");
  if (old && editingOriginal) {
    if (cards.some(card => card.id && !old.cards.some(live => live.id === card.id))) {
      return editorError("A card was removed on another device. Reopen this editor to get the current deck.");
    }
    const originalIds = new Set(editingOriginal.cards.map(card => card.id));
    cards.push(...old.cards.filter(card => !originalIds.has(card.id)));
  }
  const deck = {
    ...old, id: old?.id ?? crypto.randomUUID(), name, category, frontLanguage, backLanguage, cards,
    correct: old?.correct ?? 0, attempts: old?.attempts ?? 0
  };
  if (old && editingOriginal) {
    for (const key of ['name', 'category', 'frontLanguage', 'backLanguage']) {
      const initial = editingOriginal[key] ?? (key === 'frontLanguage' ? 'fr' : key === 'backLanguage' ? 'en' : undefined);
      if (deck[key] === initial && old[key] !== undefined) deck[key] = old[key];
    }
  }
  const decks = old ? data.decks.map(item => item.id === old.id ? deck : item) : [...data.decks, deck];
  if (!await save({ ...data, decks })) return editorError("The deck could not be saved. Allow browser storage, then try again.");
  deckId = deck.id;
  $("editor").close();
  notice("");
  startRound();
});

$("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "flashcards-backup.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onclick = () => $("backup-file").click();
$("backup-file").onchange = async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  let imported;
  try {
    imported = prepareLibrary(JSON.parse(await file.text()));
  } catch {
    notice("That file is not a valid Flashcards backup.");
    return;
  }
  if (data.decks.length && !window.confirm("Replace the synced library on all your devices with this backup? Export a backup first to keep the current results.")) return;
  if (!await studyStore.importLibrary(imported)) {
    notice("The backup could not be saved. Allow browser storage, then try again.");
    return;
  }
  deckId = data.decks[0]?.id;
  notice("");
  startRound();
};
$("new-deck").onclick = () => {
  $("mobile-decks").close();
  openEditor();
};
$("flag-card").onclick = () => {
  $("mobile-study-options").close();
  openCardFlag();
};
$("close-flag").onclick = () => $("flag-dialog").close();
$("open-flags").onclick = () => {
  $("mobile-decks").close();
  flagError("flags-error");
  renderFlagList();
  $("flags-dialog").showModal();
};
$("close-flags").onclick = () => $("flags-dialog").close();
$("include-resolved").onchange = renderFlagList;
$("close-fix").onclick = () => $("fix-dialog").close();
$("flag-form").addEventListener("submit", async event => {
  event.preventDefault();
  const entry = reportingEntry;
  const card = cardFor(entry);
  const existing = card.flags?.find(flag => flag.id === entry.flagId);
  const flag = {
    id: existing?.id ?? crypto.randomUUID(),
    flaggedAt: existing?.flaggedAt ?? new Date().toISOString(),
    original: existing?.original ?? entry.original,
    reason: $("flag-reason").value,
    direction: entry.direction,
    note: $("flag-note").value.trim()
  };
  const flags = [flag, ...(card.flags ?? []).filter(item => item.id !== flag.id)];
  if (!await saveCardUpdate(entry, { ...card, flags })) {
    flagError("flag-error", "Your flag could not be saved. Allow browser storage, then try again.");
    return;
  }
  $("flag-dialog").close();
  render();
  $("card").focus();
});
$("fix-form").addEventListener("submit", async event => {
  event.preventDefault();
  const entry = fixingEntry;
  const card = cardFor(entry);
  const fr = $("fix-front").value.trim();
  const en = $("fix-back").value.trim();
  if (!fr || !en) return flagError("fix-error", "Fill in both sides of the card.");
  const changed = fr !== card.fr || en !== card.en;
  const flags = card.flags.map(flag => flag.id === entry.flagId
    ? { ...flag, resolvedAt: new Date().toISOString(), revision: { fr, en } } : flag);
  const updated = { ...card, fr, en, flags };
  if (changed && $("fix-reset").checked) {
    delete updated.review;
    delete updated.recallReview;
  }
  if (!await saveCardUpdate(entry, updated)) {
    flagError("fix-error", "The card could not be saved. Allow browser storage, then try again.");
    return;
  }
  $("fix-dialog").close();
  if (changed) {
    deckId = entry.deckId;
    startRound();
  } else render();
  renderFlagList();
});
$("edit-deck").onclick = () => {
  $("mobile-study-options").close();
  openEditor(findDeck());
};
$("open-mix").onclick = () => {
  $("mobile-decks").close();
  openMix();
};
$("close-mix").onclick = () => $("mix-dialog").close();
$("mix-form").addEventListener("change", updateMixStatus);
$("mix-form").addEventListener("submit", async event => {
  event.preventDefault();
  const settings = mixSelection();
  const cards = interleave(settings);
  if (!cards.length) {
    updateMixStatus();
    return;
  }
  mixSettings = settings;
  front = settings.direction;
  $("mix-dialog").close();
  notice("");
  beginRound(cards, { mix: settings.mode });
  $("card").focus();
});
$("add-card").onclick = () => addCardFields(undefined, true);
$("close-editor").onclick = () => $("editor").close();
$("card").onclick = flip;
$("open-history").onclick = () => {
  $("mobile-study-options").close();
  openHistory();
};
$("close-history").onclick = () => $("history-dialog").close();
$("incorrect").onclick = () => grade(false);
$("correct").onclick = () => grade(true);
$("skip").onclick = skipCard;
$("undo").onclick = undoGrade;
$("shuffle").onclick = () => {
  $("mobile-study-options").close();
  startRound(true);
  $("card").focus();
};
$("direction").onclick = () => {
  $("mobile-study-options").close();
  front = front === "fr" ? "en" : "fr";
  round.revealed = false;
  round.graded = false;
  render();
  if (!$("review").hidden) $("card").focus();
};
document.addEventListener("keydown", event => {
  if (saving || !studyStore || document.querySelector("dialog[open]") || $("review").hidden || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === " " && !event.target.closest("button, input, summary")) {
    event.preventDefault();
    flip();
  }
  const key = event.key.toLowerCase();
  if (key === "f") {
    event.preventDefault();
    openCardFlag();
    return;
  }
  if (key === "s") {
    event.preventDefault();
    skipCard();
    return;
  }
  const left = key === "arrowleft" || key === "a";
  const right = key === "arrowright" || key === "d";
  if (left || right || key === "1" || key === "2") {
    event.preventDefault();
    if ((left || right) && !round.revealed) flip();
    else grade(right || key === "2");
  }
});

const mobileStudy = window.matchMedia("(max-width: 760px)");
const movableControls = [
  [$("deck-library"), $("mobile-decks")],
  [$("flag-card"), $("mobile-card-actions")],
  [$("study-actions"), $("mobile-deck-controls")],
  [$("stats"), $("mobile-deck-controls")],
  [$("account-actions"), $("mobile-account-controls")]
].map(([element, mobileContainer]) => {
  const desktopPosition = document.createComment(element.id);
  element.before(desktopPosition);
  return { element, mobileContainer, desktopPosition };
});
function placeStudyControls() {
  cancelSwipe();
  $("mobile-decks").close();
  $("mobile-study-options").close();
  for (const { element, mobileContainer, desktopPosition } of movableControls) {
    // Keep the sign-in view's controls in the ordinary app header.
    if (mobileStudy.matches && !$("study-app").hidden) mobileContainer.append(element);
    else desktopPosition.after(element);
  }
}
const cancelSwipe = bindCardSwipe({
  card: $("card"), stage: $("card-stage"), feedback: $("swipe-feedback"), grade,
  getEntry: () => mobileStudy.matches && !saving && round?.revealed && !$("review").hidden &&
    !document.querySelector("dialog[open]") ? round.cards[round.index] : null
});
mobileStudy.addEventListener("change", placeStudyControls);
$("show-decks").onclick = () => { if (!saving) $("mobile-decks").showModal(); };
$("show-study-options").onclick = () => { if (!saving) $("mobile-study-options").showModal(); };
$("close-mobile-decks").onclick = () => $("mobile-decks").close();
$("close-mobile-options").onclick = () => $("mobile-study-options").close();

// Account loading starts the first round.

function refreshReviews() {
  if (Date.now() >= nextReviewRefresh) renderLibrary(categories());
  if ($("mix-dialog").open) updateMixStatus();
}

document.addEventListener("visibilitychange", refreshReviews);
document.addEventListener("visibilitychange", cancelSwipe);
setInterval(refreshReviews, 30_000);

function applyCloudLibrary(library) {
  const previousDeckId = deckId;
  const current = round?.cards[round.index];
  const previousCard = current ? cardFor(current) : null;
  data = library;
  if (!findDeck()) deckId = data.decks[0]?.id;
  if (!round || previousDeckId !== deckId || (!round.cards.length && findDeck()?.cards.length)) {
    startRound();
    return;
  }
  const currentCard = current ? cardFor(current) : null;
  if (current && !currentCard) { startRound(); return; }
  round.cards = [...round.cards.slice(0, round.index), ...round.cards.slice(round.index).filter(entry => cardFor(entry))];
  if (previousCard && currentCard && (previousCard.fr !== currentCard.fr || previousCard.en !== currentCard.en)) {
    round.revealed = false;
    round.graded = false;
  }
  if (!saving && !document.querySelector('dialog[open]')) render();
}

await startCloud({
  onStore(store) {
    studyStore = store; data = store.library; deckId = data.decks[0]?.id;
    placeStudyControls();
    startRound();
  },
  onLibrary: applyCloudLibrary,
  onSignOut() {
    studyStore = null; data = { version: currentVersion, decks: [] }; round = null;
    $('library').replaceChildren(); $('term').textContent = '';
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('study-app').hidden = true;
    placeStudyControls();
  }
});
