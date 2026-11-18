export function createRound(cards, { id, shuffle = false, mix = null }) {
  return { id, cards, index: 0, correct: 0, revealed: false, graded: false, shuffle, mix, lastGrade: null };
}

export function resetFace(round) {
  round.revealed = round.graded = false;
}

export function flipRound(round) {
  round.revealed = !round.revealed;
  if (round.revealed) round.graded = true;
}

export function skipRound(round) {
  if (round.index >= round.cards.length - 1) return false;
  round.cards.push(...round.cards.splice(round.index, 1));
  resetFace(round);
  return true;
}

export async function gradeRound(round, { correct, direction, persist, isCurrent }) {
  const index = round.index;
  const entry = round.cards[index];
  if (!entry || !round.graded) return false;
  const event = await persist({
    type: 'answer',
    payload: {
      deckId: entry.deckId, cardId: entry.cardId, direction, correct, sessionId: round.id,
      mode: round.mix ?? (round.shuffle ? 'shuffled' : 'deck')
    }
  });
  if (!isCurrent() || round.cards[round.index] !== entry) return false;
  round.index = index + 1;
  round.correct += Number(correct);
  round.lastGrade = { correct, direction, eventId: event.id };
  resetFace(round);
  return true;
}

export async function undoRound(round, { persist, isCurrent }) {
  const lastGrade = round.lastGrade;
  if (!lastGrade) return null;
  await persist({ type: 'answer.undo', payload: { answerId: lastGrade.eventId } });
  if (!isCurrent()) return null;
  round.index--;
  round.correct -= Number(lastGrade.correct);
  round.lastGrade = null;
  round.revealed = round.graded = true;
  return lastGrade.direction;
}
