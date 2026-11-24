import { test, expect } from '@playwright/test';

const card = page => page.locator('#card');
const prompt = page => page.locator('#term');

async function openStudy(page) {
  await page.goto('/flashcards/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  if (await page.locator('#show-decks').isVisible()) await page.getByRole('button', { name: 'Browse decks' }).click();
  await page.getByRole('button', { name: /^Sample one/ }).click();
  await expect(prompt(page)).toHaveText('alpha');
}

async function goToToday(page) {
  if (await page.locator('#show-decks').isVisible()) await page.getByRole('button', { name: 'My decks' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

test('Today opens due reviews and returns to the last studied deck', async ({ page }) => {
  await page.goto('/flashcards/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '23 cards due' })).toBeVisible();
  await expect(page.locator('#today-direction')).toHaveText('French → English');
  await expect(card(page)).toBeHidden();
  await expect(page.locator('#today-recent')).toBeHidden();
  await page.locator('#account-settings summary').click();
  await expect(page.locator('.account-menu > :first-child')).toContainText('test@example.invalid');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Start review' }).click();
  await expect(page.locator('#position')).toHaveText('Card 1 of 20');
  await expect(page.locator('#card-source')).toContainText('Mix fixture');
  await goToToday(page);
  if (await page.locator('#show-decks').isVisible()) await page.getByRole('button', { name: 'Browse decks' }).click();
  else {
    await page.getByRole('button', { name: 'Browse decks' }).click();
    await expect(page.getByRole('heading', { name: 'My decks' })).toBeFocused();
  }
  await page.getByRole('button', { name: /^Sample two/ }).click();
  await expect(prompt(page)).toHaveText('delta');
  await card(page).click();
  await page.locator('#correct').click();
  await expect(prompt(page)).toHaveText('epsilon');

  await goToToday(page);
  const recent = page.getByRole('button', { name: /^Sample two Last studied/ });
  await recent.click();
  await expect(prompt(page)).toHaveText('epsilon');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await recent.click();
  await expect(prompt(page)).toHaveText('delta');
  await page.locator('#account-settings summary').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Your flashcards' })).toBeVisible();
  await expect(page.locator('#account-email')).toHaveText('');
  await expect(page.locator('#today-recent-deck')).toHaveText('');
});

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

test('adding decks keeps course sections ordered, preserves progress, and skips repeated IDs', async ({ page }) => {
  await openStudy(page);
  await card(page).click();
  await page.locator('#correct').click();
  await expect(prompt(page)).toHaveText('beta');

  const file = {
    name: 'add-decks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 11, decks: [
      { id: 'one', name: 'Same ID', category: 'Synthetic', correct: 0, attempts: 0, cards: [] },
      { id: 'extra', name: 'Extra practice', category: 'Synthetic', correct: 0, attempts: 0,
        cards: [{ id: 'exercise', fr: 'Give the first person of être', en: 'Je suis', kind: 'conjugation' }] },
      ...['A1', 'A2', 'B1.2', 'B1.1'].map(category =>
        ({ id: category, name: category + ' practice', category, correct: 0, attempts: 0, cards: [] }))
    ] }))
  };
  const choose = async () => {
    await page.locator('#account-settings summary').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add decks from file' }).click();
    await (await chooser).setFiles(file);
  };
  await choose();
  const preview = page.getByRole('dialog', { name: 'Add decks' });
  await expect(preview).toContainText('5 decks to add with 1 card. Skipping 1 deck already in your library.');
  await preview.getByRole('button', { name: 'Add decks', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Added 5 decks to your library.');
  await expect(prompt(page)).toHaveText('beta');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await choose();
  await expect(page.locator('#notice')).toHaveText('This file has no new decks.');
  if (await page.locator('#show-decks').isVisible()) await page.getByRole('button', { name: 'Browse decks' }).click();
  await expect(page.locator('#library [data-category] h3')).toHaveText(['A1', 'A2', 'B1.1', 'B1.2', 'Synthetic', 'Mix practice']);
  const synthetic = page.locator('#library [data-category="Synthetic"]');
  if (!await synthetic.evaluate(summary => summary.parentElement.open)) await synthetic.click();
  await expect(page.locator('[data-deck="one"]')).toContainText('100%');
  await expect(page.getByRole('button', { name: /^Same ID/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Extra practice/ }).click();
  await expect(prompt(page)).toHaveText('Give the first person of être');
  await card(page).click();
  await expect(prompt(page)).toHaveText('Je suis');
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
  const openDecks = page.getByRole('button', { name: 'My decks' });
  await openDecks.click();
  const drawer = page.getByRole('dialog', { name: 'My decks' });
  await expect(drawer).toBeVisible();
  const edge = await drawer.boundingBox();
  expect(edge.x).toBe(0);
  await expect(drawer.getByRole('button', { name: 'Close' })).toHaveCount(0);
  const y = Math.round(edge.height / 2);
  await page.touchscreen.tap(Math.round(edge.width / 2), Math.round(edge.height - 28));
  await expect(drawer).toBeVisible();
  await page.touchscreen.tap(Math.round((edge.width + page.viewportSize().width) / 2), y);
  await expect(drawer).toBeHidden();
  await expect(prompt(page)).toHaveText('alpha');
  await openDecks.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(openDecks).toBeFocused();
  await openDecks.click();
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

test('a left swipe dismisses the drawer and preserves the active card', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'Requires Chromium touch emulation');
  await openStudy(page);
  await page.getByRole('button', { name: 'My decks' }).tap();
  const drawer = page.getByRole('dialog', { name: 'My decks' });
  const deck = await drawer.getByRole('button', { name: /^Sample two/ }).boundingBox();
  const cdp = await context.newCDPSession(page);
  const x = Math.round(deck.x + deck.width / 2);
  const y = Math.round(deck.y + deck.height / 2);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const swipe = async (dx, dy) => {
    await touch('touchStart', [{ x, y }]);
    await touch('touchMove', [{ x: x + dx, y: y + dy }]);
    await touch('touchEnd', []);
  };

  await swipe(-24, 0);
  await expect(drawer).toBeVisible();
  await swipe(0, 90);
  await expect(drawer).toBeVisible();
  await swipe(-100, 0);
  await expect(drawer).toBeHidden();
  await expect(prompt(page)).toHaveText('alpha');
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
      await page.locator('#close-mix').click();
      await goToToday(page);
      await expect(page.getByRole('heading', { name: 'No cards due' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start review' })).toBeHidden();
      return;
    }
    await page.getByLabel('All eligible cards').check();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.locator('#position')).toHaveText('Card 1 of 23');
  });
}
