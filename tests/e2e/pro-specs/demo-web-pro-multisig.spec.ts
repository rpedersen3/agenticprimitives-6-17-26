import { expect, test } from '@playwright/test';

test.describe('demo-web-pro multi-sig shell', () => {
  test('renders one live path and clearly marked future work', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /what works now: deploy a hybrid smart account/i })).toBeVisible();
    await expect(page.getByTestId('what-works-now')).toContainText('only flow here that attempts a chain write');
    await expect(page.getByTestId('flow-card-hybrid-recovery')).toContainText('live');
    await expect(page.getByTestId('future-capabilities')).toContainText('Future, not supported in this UI yet');
    await expect(page.getByTestId('future-threshold-approval')).toContainText('Session package hardening');
    await expect(page.getByTestId('future-steward-attenuation')).toContainText('H5 cross-delegation subset verifier');
  });

  test('shows hybrid address validation and deploy blocker copy', async ({ page }) => {
    await page.goto('/#/flows/hybrid-recovery');

    await expect(page.getByRole('heading', { name: /deploy a hybrid AgentAccount/i })).toBeVisible();
    await expect(page.getByText('This is the one live demo path')).toBeVisible();
    await expect(page.getByText('Connect a wallet first')).toBeVisible();
    await expect(page.getByTestId('hybrid-recovery-deploy')).toBeDisabled();
    await expect(page.getByText('ThresholdValidator installed as executor module')).toBeVisible();
  });

  test('future routes do not pretend to be working demos', async ({ page }) => {
    await page.goto('/#/flows/threshold-approval');

    await expect(page.getByRole('heading', { name: /high-risk agent delegation/i })).toBeVisible();
    await expect(page.getByText('This screen is intentionally not interactive')).toBeVisible();
    await expect(page.getByText('End-to-end quorum signature collection for T3 permissions.')).toBeVisible();
  });
});
