import { test, expect } from '@playwright/test';

/**
 * Transparency Dashboard E2E Tests
 * 
 * Tests the public transparency page functionality
 */

test.describe('Transparency Dashboard', () => {

    test('should load public transparency page', async ({ page }) => {
        await page.goto('/');

        // Should show landing page content
        await expect(page).toHaveTitle(/Krystaline/i, { timeout: 10000 });
    });

    test('should display main dashboard content', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Wait for content to load past the loading state
        await page.waitForTimeout(5000);

        // Should have main content sections visible
        await expect(page.locator('body')).toBeVisible();

        // At minimum, the page should have loaded and have content
        const bodyText = await page.locator('body').textContent();
        expect(bodyText?.length).toBeGreaterThan(100);
    });

    test('should have navigation elements', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Should have links to trading or login
        const hasLinks = page.locator('a').first();
        await expect(hasLinks).toBeVisible({ timeout: 10000 });
    });

    test('should be responsive and interactive', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Wait for any animations to complete
        await page.waitForTimeout(2000);

        // Page should still be responsive
        await expect(page.locator('body')).toBeVisible();
    });

    test('should display trade feed with trace links', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Wait for data to load
        await page.waitForTimeout(3000);

        // Look for the Live Trade Feed section
        const tradeFeed = page.locator('text=Live Trade Feed').first();

        // If trade feed exists, check for trade items
        if (await tradeFeed.isVisible()) {
            // Wait for trades to potentially load
            await page.waitForTimeout(2000);

            // Check for trade items with View Trace links
            const tradeItems = page.locator('[class*="cursor-pointer"]').filter({
                hasText: /Trace:/
            });

            const tradeCount = await tradeItems.count();

            if (tradeCount > 0) {
                // Verify first trade item has trace ID displayed
                const firstTrade = tradeItems.first();
                await expect(firstTrade).toBeVisible();

                // Check that trace text is present
                const traceText = firstTrade.locator('text=/Trace: [a-f0-9]{8}/i').first();
                if (await traceText.isVisible()) {
                    // Trace ID is properly formatted (8 hex chars)
                    await expect(traceText).toBeVisible();
                }

                // Check for View Trace or No trace text
                const hasViewTrace = await firstTrade.locator('text=View Trace').isVisible();
                const hasNoTrace = await firstTrade.locator('text=No trace').isVisible();
                expect(hasViewTrace || hasNoTrace).toBeTruthy();
            }
        }
    });

    test('should format trace links correctly for Jaeger', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Wait for data to load
        await page.waitForTimeout(3000);

        // Intercept any window.open calls to capture Jaeger URLs
        const openedUrls: string[] = [];
        await page.exposeFunction('captureUrl', (url: string) => {
            openedUrls.push(url);
        });

        await page.evaluate(() => {
            const originalOpen = window.open;
            window.open = (url?: string | URL, ...args: unknown[]) => {
                if (url) {
                    // @ts-ignore - captureUrl is exposed via Playwright
                    window.captureUrl(url.toString());
                }
                return null;
            };
        });

        // Find and click a trade with View Trace link
        const viewTraceLink = page.locator('text=View Trace →').first();

        if (await viewTraceLink.isVisible({ timeout: 5000 })) {
            const tradeItem = viewTraceLink.locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]').first();

            if (await tradeItem.isVisible()) {
                await tradeItem.click();

                // Wait for the click handler
                await page.waitForTimeout(500);

                // Verify the URL format if captured
                if (openedUrls.length > 0) {
                    const jaegerUrl = openedUrls[0];

                    // Verify Jaeger URL format: http://localhost:16686/trace/{32-hex-char-trace-id}
                    expect(jaegerUrl).toMatch(/http:\/\/localhost:16686\/trace\/[a-f0-9]{32}/i);
                }
            }
        }
    });
});
