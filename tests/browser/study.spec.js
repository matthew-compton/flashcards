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
  await page.getByRole('button', { name: 'My decks' }).click();
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

test('Chromium touch keeps swipe grading, tap, long-press, and undo available', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'Requires Chromium touch emulation');
  await openStudy(page);
  const cdp = await context.newCDPSession(page);
  const centerOfCard = async () => {
    const rect = await card(page).boundingBox();
    return { x: Math.round(rect.x + rect.width * .45), y: Math.round(rect.y + rect.height * .5) };
  };
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  const swipe = async (dx, dy = 0) => {
    const center = await centerOfCard();
    await touch('touchStart', center);
    await touch('touchMove', { x: center.x + dx, y: center.y + dy });
    await touch('touchEnd');
  };
  await swipe(120);
  await expect(prompt(page)).toHaveText('alpha');
  await touch('touchStart', await centerOfCard());
  await expect(page.getByRole('heading', { name: 'Flag card' })).toBeVisible();
  await touch('touchEnd');
  await page.locator('#close-flag').tap();
  await expect(prompt(page)).toHaveText('alpha');
  await card(page).tap();
  await expect(prompt(page)).toHaveText('first');
  await swipe(0, -100);
  await expect(prompt(page)).toHaveText('first');
  await swipe(120);
  await expect(prompt(page)).toHaveText('beta');
  await expect(page.locator('#round-score')).toHaveText('1 correct this round');
  await card(page).tap();
  await expect(prompt(page)).toHaveText('second');
  await swipe(-120);
  await expect(prompt(page)).toHaveText('gamma');
  await expect(page.locator('#round-score')).toHaveText('1 correct this round');
  await page.locator('#undo').click();
  await expect(prompt(page)).toHaveText('second');
});

test('mobile uses a left drawer and a separate account menu', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Mobile navigation');
  await openStudy(page);
  await page.getByRole('button', { name: 'My decks' }).click();
  const drawer = page.getByRole('dialog', { name: 'My decks' });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox()).x).toBe(0);
  await drawer.getByRole('button', { name: /^Sample two/ }).click();
  await expect(drawer).toBeHidden();
  await expect(prompt(page)).toHaveText('delta');
  await page.locator('#mobile-settings summary').click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeHidden();
});

for (const mode of ['Review due cards', 'Missed cards', 'Shuffle selected decks']) {
  test(`Interleave can study ${mode} in chunks or all at once`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Review selection is shared with mobile');
    await openStudy(page);
    await page.getByRole('button', { name: 'Interleave your decks' }).click();
    await page.getByText(mode, { exact: true }).click();
    await page.getByLabel('Synthetic').uncheck();
    await expect(page.getByLabel('20 at a time')).toBeChecked();
    await expect(page.locator('#mix-status')).toHaveText('20 of 23 eligible cards in the first round');
    await page.getByLabel('All eligible cards').check();
    await expect(page.locator('#mix-status')).toContainText('23 card');
    await page.getByLabel('20 at a time').check();
    await page.getByRole('button', { name: 'Start review' }).click();
    const studied = [];
    for (let index = 0; index < 23; index++) {
      if (index === 20) await page.getByRole('button', { name: 'Next 3' }).click();
      await expect(page.locator('#position')).toHaveText(index < 20 ? `Card ${index + 1} of 20` : `Card ${index - 19} of 3`);
      studied.push(await prompt(page).textContent());
      await card(page).click();
      await page.locator('#incorrect').click();
    }
    expect(new Set(studied).size).toBe(23);
    await page.getByRole('button', { name: 'Start another mix' }).click();
    if (mode === 'Review due cards') {
      await expect(page.getByRole('button', { name: 'Start review' })).toBeDisabled();
      return;
    }
    await page.getByLabel('All eligible cards').check();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.locator('#position')).toHaveText('Card 1 of 23');
  });
}
