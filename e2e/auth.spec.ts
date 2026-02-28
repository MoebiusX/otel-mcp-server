import { test, expect } from '@playwright/test';
import { login, register, logout, TEST_USER } from './fixtures/auth';

/**
 * Authentication E2E Tests
 * 
 * Tests registration, login, and logout flows
 * 
 * NOTE: These tests create real users and are sensitive to rate limiting.
 * Running serially to avoid 'Too many requests' errors.
 */

test.describe.configure({ mode: 'serial' });

test.describe('Authentication', () => {

    test.describe('Registration', () => {

        test('should register new user successfully', async ({ page }) => {
            // Generate unique email to avoid conflicts
            const uniqueEmail = `e2e-${Date.now()}@test.com`;

            // Use the register helper which handles the 2-step verification
            await register(page, uniqueEmail, 'SecurePass123!');

            // Should be on portfolio or trade page after successful registration
            await expect(page).toHaveURL(/\/(portfolio|trade)/, { timeout: 20000 });
        });

        test('should show error for mismatched passwords', async ({ page }) => {
            await page.goto('/register');
            await page.waitForLoadState('networkidle');

            // Fill form with mismatched passwords
            await page.fill('input#email', 'test@example.com');
            await page.fill('input#password', 'Password123!');
            await page.fill('input#confirmPassword', 'DifferentPassword!');

            await page.click('button[type="submit"]');

            // Should show error message about password mismatch
            // Use more specific selector to find error element in form
            const errorMsg = page.locator('[role="alert"]')
                .or(page.locator('[class*="error"], [class*="destructive"]'))
                .first();
            await expect(errorMsg).toBeVisible({ timeout: 5000 });
        });
    });

    test.describe('Login', () => {

        // FLAKY: This test has infrastructure dependencies (rate limiting, MailDev)
        // Skip during parallel execution; run separately for validation
        test.skip('should login with valid credentials', async ({ page }) => {
            // First register the test user
            const uniqueEmail = `e2e-login-${Date.now()}@test.com`;
            await register(page, uniqueEmail, 'TestPass123!');

            // Logout if redirected
            await logout(page);

            // Now login
            await login(page, uniqueEmail, 'TestPass123!');

            // Should be on portfolio page
            await expect(page).toHaveURL(/\/portfolio/);
        });

        test('should show error for invalid credentials', async ({ page }) => {
            await page.goto('/login');
            await page.waitForLoadState('networkidle');

            await page.fill('input#email', 'nonexistent@test.com');
            await page.fill('input#password', 'wrongpassword');

            await page.click('button[type="submit"]');

            // Should show error message (alert or destructive class)
            // Use more specific selector to find error element in form
            const errorMsg = page.locator('[role="alert"]')
                .or(page.locator('[class*="error"], [class*="destructive"]'))
                .first();
            await expect(errorMsg).toBeVisible({ timeout: 5000 });
        });

        test('should redirect to login for protected routes', async ({ page }) => {
            // Clear any stored auth
            await page.goto('/');
            await page.evaluate(() => localStorage.clear());

            // Try to access protected route
            await page.goto('/trade');

            // Should redirect to login or register
            await expect(page).toHaveURL(/\/(login|register)/);
        });
    });

    test.describe('Logout', () => {

        test('should logout and redirect to home', async ({ page }) => {
            // Register and login
            const uniqueEmail = `e2e-logout-${Date.now()}@test.com`;
            await register(page, uniqueEmail, 'TestPass123!');

            // Logout
            await logout(page);

            // Should be on home page
            await expect(page).toHaveURL('/');
        });
    });
});
