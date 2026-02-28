import { Page, expect } from '@playwright/test';

/**
 * Trading fixture helpers for E2E tests
 */

export interface WalletBalance {
    btc: number;
    usd: number;
    totalValue: number;
}

/**
 * Get current wallet balance from the portfolio panel
 */
export async function getWalletBalance(page: Page): Promise<WalletBalance> {
    // Navigate to trade page if not already there
    if (!page.url().includes('/trade')) {
        await page.goto('/trade');
    }

    // Wait for portfolio to load - use regex for i18n
    await page.getByText(/Your Portfolio|Tu Portafolio/i).waitFor({ timeout: 10000 });

    // Wait a bit for data to load
    await page.waitForTimeout(500);

    let btc = 0;
    let usd = 0;
    let totalValue = 0;

    try {
        // Find the paragraph that contains "BTC Balance" text, then get the next sibling paragraph with the value
        // Based on error context: paragraph "BTC Balance" [ref=e100], paragraph "1.000000" [ref=e101]
        const btcLabelLocator = page.locator('p').filter({ hasText: /^BTC Balance$/i });
        if (await btcLabelLocator.count() > 0) {
            // The balance value is in a sibling paragraph immediately after the label
            const btcValueLocator = btcLabelLocator.locator('xpath=following-sibling::p[1]');
            const btcText = await btcValueLocator.textContent() || '0';
            btc = parseFloat(btcText.replace(/[^0-9.]/g, '')) || 0;
        }
    } catch { btc = 0; }

    try {
        // Find the paragraph that contains "USD Balance" text, then get the next sibling paragraph with the value
        const usdLabelLocator = page.locator('p').filter({ hasText: /^USD Balance$/i });
        if (await usdLabelLocator.count() > 0) {
            const usdValueLocator = usdLabelLocator.locator('xpath=following-sibling::p[1]');
            const usdText = await usdValueLocator.textContent() || '0';
            usd = parseFloat(usdText.replace(/[^0-9,.]/g, '')) || 0;
        }
    } catch { usd = 0; }

    try {
        // Get total balance from header section
        const totalLocator = page.locator('p').filter({ hasText: /^Total Balance \(USD\)$/i });
        if (await totalLocator.count() > 0) {
            const totalValueLocator = totalLocator.locator('xpath=following-sibling::p[1]');
            const totalText = await totalValueLocator.textContent() || '0';
            totalValue = parseFloat(totalText.replace(/[^0-9,.]/g, '')) || 0;
        } else {
            totalValue = btc * 80000 + usd; // Fallback calculation
        }
    } catch { totalValue = btc * 80000 + usd; }

    return { btc, usd, totalValue };
}

/**
 * Submit a buy order through the UI
 */
export async function submitBuyOrder(page: Page, amount: number): Promise<void> {
    // Ensure we're on the trade page
    if (!page.url().includes('/trade')) {
        await page.goto('/trade');
    }

    // Wait for trade form to load - look for BUY button instead of translated text
    await page.getByRole('button', { name: /^BUY$/i }).waitFor({ timeout: 10000 });

    // Click BUY toggle button
    await page.getByRole('button', { name: /^BUY$/i }).click();

    // Fill amount
    await page.locator('input[type="number"]').first().fill(amount.toString());

    // Submit order - button text is "Buy X.XXXX BTC"
    await page.getByRole('button', { name: /Buy.*BTC/i }).click();

    // Wait for execution toast or confirmation - target the heading specifically to avoid strict mode violation
    await page.getByRole('heading', { name: /Trade.*Executed|Order Submitted|Operaci.n.*Ejecutad/i }).first().waitFor({ timeout: 15000 });
}

/**
 * Submit a sell order through the UI
 */
export async function submitSellOrder(page: Page, amount: number): Promise<void> {
    // Ensure we're on the trade page
    if (!page.url().includes('/trade')) {
        await page.goto('/trade');
    }

    // Wait for trade form to load - look for SELL button instead of translated text
    await page.getByRole('button', { name: /^SELL$/i }).waitFor({ timeout: 10000 });

    // Click SELL toggle button
    await page.getByRole('button', { name: /^SELL$/i }).click();

    // Fill amount
    await page.locator('input[type="number"]').first().fill(amount.toString());

    // Submit order - button text is "Sell X.XXXX BTC"
    await page.getByRole('button', { name: /Sell.*BTC/i }).click();

    // Wait for execution toast or confirmation - target the heading specifically to avoid strict mode violation
    await page.getByRole('heading', { name: /Trade.*Executed|Order Submitted|Operaci.n.*Ejecutad/i }).first().waitFor({ timeout: 15000 });
}

/**
 * Wait for trade to appear in recent activity
 */
export async function waitForTradeInActivity(page: Page, side: 'BUY' | 'SELL'): Promise<void> {
    await page.getByText(side).waitFor({ timeout: 10000 });
}

/**
 * Check if order was rejected (insufficient funds)
 * Checks multiple UI elements: toasts, alerts, and inline error messages
 */
export async function isOrderRejected(page: Page): Promise<boolean> {
    // Wait a bit for any error to appear
    await page.waitForTimeout(2000);

    // Check for various error indicators
    const errorPatterns = [
        // Text patterns for insufficient funds
        /insufficient|rejected|failed|error|not enough|can't process/i,
        // Toast-specific patterns  
        /balance.*insufficient|Insufficient.*balance/i,
    ];

    // Check toasts (often in a separate region)
    const toastRegion = page.locator('[role="region"]').filter({ hasText: /notification/i });
    const alerts = page.locator('[role="alert"]');
    const errorClasses = page.locator('[class*="error"], [class*="destructive"], [class*="toast"]');
    const errorText = page.getByText(/insufficient|rejected|failed|error/i);

    try {
        // Wait for any of these error indicators
        await Promise.race([
            toastRegion.waitFor({ state: 'visible', timeout: 5000 }),
            alerts.first().waitFor({ state: 'visible', timeout: 5000 }),
            errorClasses.first().waitFor({ state: 'visible', timeout: 5000 }),
            errorText.first().waitFor({ state: 'visible', timeout: 5000 }),
        ]);
        return true;
    } catch {
        // If no error visible, also check if order is still pending/disabled
        const processingButton = page.locator('button:disabled').filter({ hasText: /processing/i });
        const pendingOrder = page.getByText(/pending|processing/i);

        try {
            await Promise.race([
                processingButton.waitFor({ state: 'visible', timeout: 2000 }),
                pendingOrder.waitFor({ state: 'visible', timeout: 2000 }),
            ]);
            // Order is being processed, not rejected
            return false;
        } catch {
            return false;
        }
    }
}
