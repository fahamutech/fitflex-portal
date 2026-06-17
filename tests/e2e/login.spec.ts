import { expect, test } from '@playwright/test';

test('login renders cleanly on iPhone 15 Pro Max and opens email form', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Operator / Admin login' })).toBeVisible();
  await expect(page.getByTestId('google-submit')).toBeVisible();
  await expect(page.getByText('Unable to process request due to missing initial state')).toHaveCount(0);

  await page.getByTestId('email-method-btn').click();

  await expect(page.getByTestId('email-input')).toBeVisible();
  await expect(page.getByTestId('password-input')).toBeVisible();
  expect(consoleMessages).toEqual([]);

  await context.close();
});
