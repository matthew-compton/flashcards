import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCardSwipe } from '../src/swipe.js';

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
  let entry = null;
  const cancel = bindCardSwipe({ card, stage, feedback, getEntry: () => entry, grade: value => grades.push(value) });
  function pointer(type, clientX, clientY = 200, options = {}) {
    card.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, pointerType: 'touch', isPrimary: true, clientX, clientY, ...options
    }));
  }
  function click(detail = 1) {
    return card.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail }));
  }
  return { pointer, click, cancel, feedback, grades, reveal: () => { entry = {}; } };
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
  const { pointer, click, cancel, grades, reveal } = fixture();
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
  reveal();
  pointer('pointerup', 300);

  pointer('pointerdown', 180);
  pointer('pointermove', 300);
  cancel();
  pointer('pointerup', 300);
  pointer('pointerdown', 180);
  pointer('pointerup', 181);
  assert.equal(click(), true);
  assert.deepEqual(grades, []);
});
