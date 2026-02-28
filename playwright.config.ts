import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * 
 * Run tests with: npx playwright test
 * Run with UI: npx playwright test --ui
 * Run headed: npx playwright test --headed
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // Add retries for flaky tests (2 in CI, 1 locally)
    retries: process.env.CI ? 2 : 1,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    // Increase test timeout for slower operations
    timeout: 60 * 1000,
    // Expect timeout for assertions
    expect: {
        timeout: 10 * 1000,
    },

    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
        // Increase action timeout for slow UI operations
        actionTimeout: 15 * 1000,
        // Increase navigation timeout
        navigationTimeout: 30 * 1000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Run dev server before tests
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
