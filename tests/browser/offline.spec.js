import { test, expect } from '@playwright/test';

test('a queued offline grade survives an atomic shell upgrade and syncs once', async ({ page, context, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'Run the shell upgrade once in Chromium');
  await request.post('/test-release?version=v1');
  try {
    await page.goto('/flashcards/');
    await expect(page.locator('#term')).toHaveText('alpha');
    await expect(page.locator('#sync-status')).toHaveText('Synced');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state))
      .toBe('activated');
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await page.locator('#card').click();
    await page.locator('#correct').click();
    await expect(page.locator('#term')).toHaveText('beta');
    await expect(page.locator('#sync-status')).toContainText('waiting to sync');

    // Let the browser download the update while the study server stays unreachable.
    await context.route('**/test-sync', route => route.abort());
    await request.post('/test-release?version=v2');
    await context.setOffline(false);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    await expect(page.locator('meta[name=fixture-release]')).toHaveAttribute('content', 'v1');
    await page.close();
    await context.unroute('**/test-sync');
    const upgraded = await context.newPage();
    await upgraded.goto('/flashcards/');
    await expect(upgraded.locator('meta[name=fixture-release]')).toHaveAttribute('content', 'v2');
    await expect.poll(() => upgraded.evaluate(() => window.flashcardsTest.releaseName)).toBe('v2');
    await expect(upgraded.locator('#sync-status')).toHaveText('Synced');
    await upgraded.getByRole('button', { name: 'Session history' }).click();
    await expect(upgraded.locator('#history-list li')).toHaveCount(1);
    await expect(upgraded.locator('#history-list')).toContainText('1 of 1 correct');
  } finally {
    await context.setOffline(false);
    await request.post('/test-release?version=v1');
  }
});
