import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

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

  // The page asks which sign-in methods the server offers (business PIN sign-in, S2).
  await page.route(`${API}/auth/options`, route => route.fulfill({ json: { pinLogin: false } }));
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to FitFlex for partners' })).toBeVisible();
  await expect(page.getByTestId('google-submit')).toBeVisible();
  await expect(page.getByText('Unable to process request due to missing initial state')).toHaveCount(0);

  await page.getByTestId('email-method-btn').click();

  await expect(page.getByTestId('email-input')).toBeVisible();
  await expect(page.getByTestId('password-input')).toBeVisible();
  expect(consoleMessages).toEqual([]);

  await context.close();
});
