import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { materialize } from '../src/model.js';

const decks = Array.from({ length: 44 }, (_, d) => ({
  id: 'deck-' + d, name: 'Deck ' + d, category: 'Practice', attempts: 0, correct: 0,
  cards: Array.from({ length: 29 }, (_, c) => ({ id: 'card-' + c, fr: 'Cue ' + c, en: 'Answer ' + c }))
}));
const start = Date.UTC(2026, 0, 1);
const baseline = { id: 'baseline', type: 'library.initialize', at: new Date(start).toISOString(),
  payload: { library: { version: 11, decks } } };
const records = [{ revision: 1, event: baseline }];
for (let i = 0; i < 10_000; i++) records.push({ revision: i + 2, event: {
  id: 'answer-' + i, generation: 'baseline', type: 'answer', at: new Date(start + i * 7900).toISOString(),
  payload: { deckId: 'deck-' + (Math.floor(i / 20) % 15), cardId: 'card-' + i % 29,
    sessionId: 'round-' + Math.floor(i / 20), direction: i % 2 ? 'en' : 'fr', correct: i % 5 !== 0, mode: 'deck' }
} });
for (const answers of [100, 1000, 10_000]) {
  const rows = records.slice(0, answers + 1);
  materialize(rows);
  const timings = Array.from({ length: 7 }, () => {
    const before = performance.now();
    const library = materialize(rows).library;
    assert.equal(library.decks.reduce((n, deck) => n + deck.attempts, 0), answers);
    return performance.now() - before;
  }).sort((a, b) => a - b);
  console.log(`${answers} answers: ${timings[3].toFixed(1)} ms median replay`);
}
