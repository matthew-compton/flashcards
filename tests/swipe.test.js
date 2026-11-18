import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCardGestures } from '../src/swipe.js';

function classes() {
  const active = new Set();
  return {
    add: name => active.add(name), remove: name => active.delete(name),
    contains: name => active.has(name),
    toggle: (name, on) => on ? active.add(name) : active.delete(name)
  };
}

function fixture() {
  const card = Object.assign(new EventTarget(), { clientWidth: 360 });
  const stage = { classList: classes(), style: { setProperty() {}, removeProperty() {} } };
  const feedback = { classList: classes(), hidden: true };
  const grades = [];
  const flags = [];
  const taps = [];
  let entry = {};
  let revealed = false;
  const cancel = bindCardGestures({
    card, stage, feedback, getEntry: () => entry, isRevealed: () => revealed,
    grade: value => grades.push(value), flag: () => flags.push(entry), tap: () => taps.push(entry)
  });
  function pointer(type, clientX, clientY = 200, options = {}) {
    card.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, pointerType: 'touch', isPrimary: true, clientX, clientY, ...options
    }));
  }
  function click(detail = 1) {
    return card.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail }));
  }
  return { pointer, click, cancel, feedback, grades, flags, taps,
    reveal: () => { revealed = true; }, changeCard: () => { entry = {}; }
  };
}

test('grades left and right once on release, only on a revealed card', () => {
  const { pointer, click, feedback, grades, reveal } = fixture();
  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  assert.equal(feedback.hidden, true);
  pointer('pointerup', 300);
  assert.equal(click(), false);
  assert.deepEqual(grades, []);

  reveal();
  pointer('pointerdown', 180);
  pointer('pointermove', 65);
  assert.equal(feedback.textContent, '✕ Incorrect');
  assert.deepEqual(grades, []);
  pointer('pointerup', 65);
  assert.equal(click(), false);
  assert.equal(feedback.hidden, true);
  pointer('pointerdown', 180);
  pointer('pointermove', 302);
  pointer('pointerup', 302);
  assert.deepEqual(grades, [false, true]);
  assert.equal(click(0), true);
});

test('short drags, vertical scroll, interrupted drags and card changes do not grade', () => {
  const { pointer, click, cancel, grades, taps, reveal, changeCard } = fixture();
  reveal();
  pointer('pointerdown', 180);
  pointer('pointermove', 220);
  pointer('pointerup', 220);
  assert.equal(click(), false);

  pointer('pointerdown', 180);
  pointer('pointermove', 182, 245);
  pointer('pointerup', 295, 248);

  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  pointer('pointercancel', 300);
  pointer('pointerup', 300);

  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  changeCard();
  pointer('pointerup', 300);

  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  cancel();
  pointer('pointerup', 300);
  pointer('pointerdown', 180);
  pointer('pointerup', 181);
  assert.equal(click(), false);
  assert.equal(taps.length, 1);
  assert.deepEqual(grades, []);
});

test('holding either face opens Flag card once without flipping or grading on release', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, click, grades, flags, reveal } = fixture();
  pointer('pointerdown', 180);
  t.mock.timers.tick(499);
  assert.equal(flags.length, 0);
  t.mock.timers.tick(1);
  t.mock.timers.tick(2000);
  assert.equal(flags.length, 1);
  pointer('pointerup', 300);
  assert.equal(click(), false);

  reveal();
  pointer('pointerdown', 180);
  t.mock.timers.tick(500);
  pointer('pointerup', 65);
  assert.equal(click(), false);
  assert.equal(flags.length, 2);
  assert.deepEqual(grades, []);
});

test('tap, scroll, swipe, canceled touch, and a changed card never open Flag card', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, click, grades, flags, taps, reveal, changeCard } = fixture();
  pointer('pointerdown', 180);
  pointer('pointerup', 180);
  assert.equal(click(), false);
  assert.equal(taps.length, 1);
  t.mock.timers.tick(500);

  pointer('pointerdown', 180);
  pointer('pointermove', 181, 255);
  t.mock.timers.tick(500);
  pointer('pointerup', 181, 255);

  reveal();
  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  t.mock.timers.tick(500);
  pointer('pointerup', 300);

  pointer('pointerdown', 180);
  pointer('pointercancel', 180);
  t.mock.timers.tick(500);

  pointer('pointerdown', 180);
  changeCard();
  t.mock.timers.tick(500);
  pointer('pointerup', 180);
  assert.equal(flags.length, 0);
  assert.equal(taps.length, 1);
  assert.deepEqual(grades, [true]);
});
