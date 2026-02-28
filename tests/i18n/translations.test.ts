/**
 * i18n Unit Tests
 * 
 * Tests for internationalization configuration and translation files.
 * Verifies:
 * - All translation keys exist in all languages
 * - No missing translations
 * - Proper namespace structure
 * - Language switching works correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load translation files via fs (Node environment)
const localesPath = path.resolve(__dirname, '../../client/src/i18n/locales');

let enCommon: Record<string, unknown>;
let enAuth: Record<string, unknown>;
let enTrading: Record<string, unknown>;
let enDashboard: Record<string, unknown>;

let esCommon: Record<string, unknown>;
let esAuth: Record<string, unknown>;
let esTrading: Record<string, unknown>;
let esDashboard: Record<string, unknown>;

beforeAll(() => {
    // Load English translations
    enCommon = JSON.parse(fs.readFileSync(path.join(localesPath, 'en/common.json'), 'utf-8'));
    enAuth = JSON.parse(fs.readFileSync(path.join(localesPath, 'en/auth.json'), 'utf-8'));
    enTrading = JSON.parse(fs.readFileSync(path.join(localesPath, 'en/trading.json'), 'utf-8'));
    enDashboard = JSON.parse(fs.readFileSync(path.join(localesPath, 'en/dashboard.json'), 'utf-8'));

    // Load Spanish translations
    esCommon = JSON.parse(fs.readFileSync(path.join(localesPath, 'es/common.json'), 'utf-8'));
    esAuth = JSON.parse(fs.readFileSync(path.join(localesPath, 'es/auth.json'), 'utf-8'));
    esTrading = JSON.parse(fs.readFileSync(path.join(localesPath, 'es/trading.json'), 'utf-8'));
    esDashboard = JSON.parse(fs.readFileSync(path.join(localesPath, 'es/dashboard.json'), 'utf-8'));
});

/**
 * Recursively extracts all keys from a nested object
 */
function extractKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            keys.push(...extractKeys(obj[key] as Record<string, unknown>, fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

/**
 * Gets value at a nested path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current, key) => {
        if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
            return (current as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj as unknown);
}

describe('i18n Translation Files', () => {
    describe('Common Namespace', () => {
        it('should have matching keys between EN and ES', () => {
            const enKeys = extractKeys(enCommon);
            const esKeys = extractKeys(esCommon);

            const missingInEs = enKeys.filter(key => !esKeys.includes(key));
            const missingInEn = esKeys.filter(key => !enKeys.includes(key));

            expect(missingInEs, `Missing in Spanish: ${missingInEs.join(', ')}`).toEqual([]);
            expect(missingInEn, `Missing in English: ${missingInEn.join(', ')}`).toEqual([]);
        });

        it('should have all required nav keys', () => {
            const requiredNavKeys = ['home', 'portfolio', 'trade', 'transparency', 'profile', 'logout'];
            const nav = enCommon.nav as Record<string, unknown>;
            const navEs = esCommon.nav as Record<string, unknown>;

            for (const key of requiredNavKeys) {
                expect(nav).toHaveProperty(key);
                expect(navEs).toHaveProperty(key);
            }
        });

        it('should have all required button keys', () => {
            const requiredButtonKeys = ['continue', 'cancel', 'save', 'submit', 'close', 'back', 'next'];
            const buttons = enCommon.buttons as Record<string, unknown>;
            const buttonsEs = esCommon.buttons as Record<string, unknown>;

            for (const key of requiredButtonKeys) {
                expect(buttons).toHaveProperty(key);
                expect(buttonsEs).toHaveProperty(key);
            }
        });

        it('should have all required error keys', () => {
            const requiredErrorKeys = ['generic', 'network', 'unauthorized', 'notFound'];
            const errors = enCommon.errors as Record<string, unknown>;
            const errorsEs = esCommon.errors as Record<string, unknown>;

            for (const key of requiredErrorKeys) {
                expect(errors).toHaveProperty(key);
                expect(errorsEs).toHaveProperty(key);
            }
        });
    });

    describe('Auth Namespace', () => {
        it('should have matching keys between EN and ES', () => {
            const enKeys = extractKeys(enAuth);
            const esKeys = extractKeys(esAuth);

            const missingInEs = enKeys.filter(key => !esKeys.includes(key));
            const missingInEn = esKeys.filter(key => !enKeys.includes(key));

            expect(missingInEs, `Missing in Spanish: ${missingInEs.join(', ')}`).toEqual([]);
            expect(missingInEn, `Missing in English: ${missingInEn.join(', ')}`).toEqual([]);
        });

        it('should have login section', () => {
            expect(enAuth).toHaveProperty('login');
            expect(esAuth).toHaveProperty('login');
        });

        it('should have register section', () => {
            expect(enAuth).toHaveProperty('register');
            expect(esAuth).toHaveProperty('register');
        });

        it('should have 2FA section', () => {
            expect(enAuth).toHaveProperty('twoFactor');
            expect(esAuth).toHaveProperty('twoFactor');
        });
    });

    describe('Trading Namespace', () => {
        it('should have matching keys between EN and ES', () => {
            const enKeys = extractKeys(enTrading);
            const esKeys = extractKeys(esTrading);

            const missingInEs = enKeys.filter(key => !esKeys.includes(key));
            const missingInEn = esKeys.filter(key => !enKeys.includes(key));

            expect(missingInEs, `Missing in Spanish: ${missingInEs.join(', ')}`).toEqual([]);
            expect(missingInEn, `Missing in English: ${missingInEn.join(', ')}`).toEqual([]);
        });

        it('should have tradeForm section', () => {
            expect(enTrading).toHaveProperty('tradeForm');
            expect(esTrading).toHaveProperty('tradeForm');
        });

        it('should have tradeVerified section', () => {
            expect(enTrading).toHaveProperty('tradeVerified');
            expect(esTrading).toHaveProperty('tradeVerified');
        });

        it('should have orderHistory section', () => {
            expect(enTrading).toHaveProperty('orderHistory');
            expect(esTrading).toHaveProperty('orderHistory');
        });

        it('should have transparency section', () => {
            expect(enTrading).toHaveProperty('transparency');
            expect(esTrading).toHaveProperty('transparency');
        });

        it('should have convert section', () => {
            expect(enTrading).toHaveProperty('convert');
            expect(esTrading).toHaveProperty('convert');
        });

        it('should have asset translations', () => {
            const requiredAssets = ['BTC', 'ETH', 'USD', 'USDT', 'EUR'];
            const assets = enTrading.assets as Record<string, unknown>;
            const assetsEs = esTrading.assets as Record<string, unknown>;

            for (const asset of requiredAssets) {
                expect(assets).toHaveProperty(asset);
                expect(assetsEs).toHaveProperty(asset);
            }
        });
    });

    describe('Dashboard Namespace', () => {
        it('should have matching keys between EN and ES', () => {
            const enKeys = extractKeys(enDashboard);
            const esKeys = extractKeys(esDashboard);

            const missingInEs = enKeys.filter(key => !esKeys.includes(key));
            const missingInEn = esKeys.filter(key => !enKeys.includes(key));

            expect(missingInEs, `Missing in Spanish: ${missingInEs.join(', ')}`).toEqual([]);
            expect(missingInEn, `Missing in English: ${missingInEn.join(', ')}`).toEqual([]);
        });

        it('should have welcome section', () => {
            expect(enDashboard).toHaveProperty('welcome');
            expect(esDashboard).toHaveProperty('welcome');
        });

        it('should have portfolio section', () => {
            expect(enDashboard).toHaveProperty('portfolio');
            expect(esDashboard).toHaveProperty('portfolio');
        });

        it('should have journey section', () => {
            expect(enDashboard).toHaveProperty('journey');
            expect(esDashboard).toHaveProperty('journey');
        });

        it('should have activity section', () => {
            expect(enDashboard).toHaveProperty('activity');
            expect(esDashboard).toHaveProperty('activity');
        });

        it('should have tabs section', () => {
            expect(enDashboard).toHaveProperty('tabs');
            expect(esDashboard).toHaveProperty('tabs');
        });
    });

    describe('Translation Quality', () => {
        it('should have translations that differ between EN and ES', () => {
            // Check a few key phrases that should definitely be different
            const enNav = enCommon.nav as Record<string, string>;
            const esNav = esCommon.nav as Record<string, string>;
            expect(enNav.home).not.toBe(esNav.home);

            const enLogin = (enAuth.login as Record<string, string>);
            const esLogin = (esAuth.login as Record<string, string>);
            expect(enLogin.title).not.toBe(esLogin.title);
        });
    });

    describe('Interpolation Variables', () => {
        it('should have matching interpolation variables in common namespace', () => {
            // Check footer copyright has {{year}} in both
            const enFooter = enCommon.footer as Record<string, string>;
            const esFooter = esCommon.footer as Record<string, string>;
            expect(enFooter.copyright).toContain('{{year}}');
            expect(esFooter.copyright).toContain('{{year}}');
        });

        it('should have matching interpolation variables in trading namespace', () => {
            // Check availableBalance has {{balance}} and {{asset}}
            const enTradeForm = enTrading.tradeForm as Record<string, string>;
            const esTradeForm = esTrading.tradeForm as Record<string, string>;
            expect(enTradeForm.availableBalance).toContain('{{balance}}');
            expect(enTradeForm.availableBalance).toContain('{{asset}}');
            expect(esTradeForm.availableBalance).toContain('{{balance}}');
            expect(esTradeForm.availableBalance).toContain('{{asset}}');
        });
    });

    describe('Key Count Consistency', () => {
        it('should have the same number of keys in EN and ES common', () => {
            const enKeyCount = extractKeys(enCommon).length;
            const esKeyCount = extractKeys(esCommon).length;
            expect(enKeyCount).toBe(esKeyCount);
        });

        it('should have the same number of keys in EN and ES auth', () => {
            const enKeyCount = extractKeys(enAuth).length;
            const esKeyCount = extractKeys(esAuth).length;
            expect(enKeyCount).toBe(esKeyCount);
        });

        it('should have the same number of keys in EN and ES trading', () => {
            const enKeyCount = extractKeys(enTrading).length;
            const esKeyCount = extractKeys(esTrading).length;
            expect(enKeyCount).toBe(esKeyCount);
        });

        it('should have the same number of keys in EN and ES dashboard', () => {
            const enKeyCount = extractKeys(enDashboard).length;
            const esKeyCount = extractKeys(esDashboard).length;
            expect(enKeyCount).toBe(esKeyCount);
        });
    });

    describe('File Structure', () => {
        it('should have all required locale directories', () => {
            expect(fs.existsSync(path.join(localesPath, 'en'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'es'))).toBe(true);
        });

        it('should have all required namespace files for English', () => {
            expect(fs.existsSync(path.join(localesPath, 'en/common.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'en/auth.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'en/trading.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'en/dashboard.json'))).toBe(true);
        });

        it('should have all required namespace files for Spanish', () => {
            expect(fs.existsSync(path.join(localesPath, 'es/common.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'es/auth.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'es/trading.json'))).toBe(true);
            expect(fs.existsSync(path.join(localesPath, 'es/dashboard.json'))).toBe(true);
        });
    });
});
