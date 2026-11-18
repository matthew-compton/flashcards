const dragStart = 12;
const holdDuration = 500;

export function bindCardGestures({ card, stage, feedback, getEntry, isRevealed, grade, flag }) {
  let gesture;
  let ignoreClickUntil = 0;

  function clearPreview() {
    if (stage.classList.contains('swipe-active')) stage.classList.add('swipe-return');
    stage.classList.remove('swipe-active');
    stage.style.removeProperty('--swipe-offset');
    feedback.hidden = true;
  }

  function cancel() {
    clearTimeout(gesture?.holdTimer);
    if (gesture?.axis || gesture?.held) ignoreClickUntil = performance.now() + 500;
    gesture = null;
    clearPreview();
  }

  card.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') { cancel(); ignoreClickUntil = 0; return; }
    if (!event.isPrimary) {
      if (gesture) ignoreClickUntil = performance.now() + 500;
      cancel();
      return;
    }
    ignoreClickUntil = 0;
    const entry = getEntry();
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY, entry, revealed: isRevealed(),
      threshold: Math.max(52, Math.min(92, card.clientWidth * .24))
    };
    if (entry) {
      gesture.holdTimer = setTimeout(() => {
        if (gesture?.entry !== entry || getEntry() !== entry) return;
        gesture.held = true;
        flag();
      }, holdDuration);
    }
  });

  function track(event) {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= dragStart) {
      clearTimeout(gesture.holdTimer);
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'horizontal' : 'vertical';
    }
    const horizontal = gesture.axis === 'horizontal' && Math.abs(dx) > Math.abs(dy) * 1.3;
    return { dx, horizontal, ready: horizontal && Math.abs(dx) >= gesture.threshold };
  }

  card.addEventListener('pointermove', event => {
    if (event.pointerId !== gesture?.id || gesture.held) return;
    const { dx, horizontal, ready } = track(event);
    if (!horizontal || !gesture.entry || !gesture.revealed || !isRevealed() || gesture.entry !== getEntry()) {
      clearPreview();
      return;
    }
    stage.classList.remove('swipe-return');
    stage.classList.add('swipe-active');
    stage.style.setProperty('--swipe-offset', `${Math.max(-110, Math.min(110, dx * .65))}px`);
    feedback.textContent = dx > 0 ? '✓ Correct' : '✕ Incorrect';
    feedback.classList.toggle('correct', dx > 0);
    feedback.classList.toggle('incorrect', dx < 0);
    feedback.classList.toggle('ready', ready);
    feedback.hidden = false;
  });

  card.addEventListener('pointerup', event => {
    if (event.pointerId !== gesture?.id) return;
    const { dx, ready } = track(event);
    const commit = ready && !gesture.held && gesture.revealed && isRevealed() && gesture.entry && gesture.entry === getEntry();
    cancel();
    if (commit) grade(dx > 0);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    card.addEventListener(type, event => {
      if (event.pointerId === gesture?.id) cancel();
    });
  }

  card.addEventListener('contextmenu', event => {
    if (gesture?.entry || (event.pointerType === 'touch' && getEntry())) event.preventDefault();
  });

  // A touch drag or hold can still generate a click. Let normal taps and keyboard clicks flip the card.
  card.addEventListener('click', event => {
    if (event.detail === 0 || (!gesture?.held && performance.now() >= ignoreClickUntil)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ignoreClickUntil = 0;
  }, true);

  return cancel;
}
