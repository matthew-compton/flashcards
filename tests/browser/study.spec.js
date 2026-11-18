import { test, expect } from '@playwright/test';

const card = page => page.locator('#card');
const prompt = page => page.locator('#term');

async function openStudy(page) {
  await page.goto('/flashcards/');
  await expect(prompt(page)).toHaveText('alpha');
}

test('tap to reveal, grade, undo, and return a skipped card to the end', async ({ page }) => {
  await openStudy(page);
  const correct = page.getByRole('button', { name: /✓.*Correct/i });
  await expect(correct).toBeDisabled();
  await card(page).click();
  await expect(prompt(page)).toHaveText('first');
  await correct.click();
  await expect(prompt(page)).toHaveText('beta');
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(prompt(page)).toHaveText('first');
  await page.getByRole('button', { name: /^Skip/ }).click();
  await expect(prompt(page)).toHaveText('beta');
  for (const next of ['gamma', 'alpha']) {
    await card(page).click();
    await correct.click();
    await expect(prompt(page)).toHaveText(next);
  }
});

test('a delayed answer never grades or advances the newly selected round', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The desktop sidebar stays available during a save');
  await openStudy(page);
  await page.evaluate(() => window.flashcardsTest.holdNextSave());
  await card(page).click();
  await page.getByRole('button', { name: /✓.*Correct/i }).click();
  await expect.poll(() => page.evaluate(() => window.flashcardsTest.hasHeldSave)).toBe(true);
  await page.getByRole('button', { name: /^Sample two/ }).click();
  await expect(prompt(page)).toHaveText('delta');
  await page.evaluate(() => window.flashcardsTest.release());
  await expect(page.getByRole('button', { name: /^Sample one/ })).toContainText('100%');
  await expect(prompt(page)).toHaveText('delta');
  await expect(page.getByRole('button', { name: /Undo/ })).toBeDisabled();
});

test('mobile menu flags a card and the editor previews a split', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Mobile menu');
  await openStudy(page);
  await page.getByRole('button', { name: 'Study options' }).click();
  await page.getByRole('button', { name: 'Flag card', exact: true }).click();
  await page.locator('#flag-note').fill('Two small questions');
  await page.locator('#flag-form button[type=submit]').click();
  await page.getByRole('button', { name: /Decks/ }).click();
  await page.getByRole('button', { name: 'Flagged cards (1)' }).click();
  await page.getByRole('button', { name: 'Improve card' }).click();
  await page.getByRole('button', { name: 'Add a card to this split' }).click();
  await page.locator('#fix-front').fill('Reworded alpha');
  await page.locator('#split-fields [data-side=front]').fill('New prompt');
  await page.locator('#split-fields [data-side=back]').fill('New answer');
  await expect(page.locator('#split-preview')).toContainText('2 cards with fresh review schedules');
  await page.locator('#fix-form button[type=submit]').click();
  await page.getByRole('dialog', { name: 'Flagged cards' }).getByRole('button', { name: 'Close' }).click();
  await expect(prompt(page)).toHaveText('Reworded alpha');
  await expect(page.locator('#position')).toHaveText('Card 1 of 4');
});

test('Chromium touch long-press flags and a swipe grades only after reveal', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'Requires Chromium touch emulation');
  await openStudy(page);
  const cdp = await context.newCDPSession(page);
  const rect = await card(page).boundingBox();
  const center = { x: Math.round(rect.x + rect.width * .45), y: Math.round(rect.y + rect.height * .5) };
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  await touch('touchStart', center);
  await expect(page.getByRole('heading', { name: 'Flag card' })).toBeVisible();
  await touch('touchEnd');
  await page.locator('#close-flag').tap();
  await expect(prompt(page)).toHaveText('alpha');
  await card(page).tap();
  await expect(prompt(page)).toHaveText('first');
  await touch('touchStart', center);
  await touch('touchMove', { ...center, x: center.x + 120 });
  await touch('touchEnd');
  await expect(prompt(page)).toHaveText('beta');
});
