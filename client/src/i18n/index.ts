/**
 * i18n Configuration for KrystalineX
 * 
 * Supports EU multi-locale with:
 * - English (default)
 * - Spanish
 * - German
 * - French
 * - Italian
 * - Portuguese
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enTrading from './locales/en/trading.json';
import enDashboard from './locales/en/dashboard.json';

import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esTrading from './locales/es/trading.json';
import esDashboard from './locales/es/dashboard.json';

// Resources bundled at build time (for now)
// Can switch to lazy loading with i18next-http-backend later
const resources = {
    en: {
        common: enCommon,
        auth: enAuth,
        trading: enTrading,
        dashboard: enDashboard,
    },
    es: {
        common: esCommon,
        auth: esAuth,
        trading: esTrading,
        dashboard: esDashboard,
    },
};

i18n
    // Detect user language
    .use(LanguageDetector)
    // Pass i18n instance to react-i18next
    .use(initReactI18next)
    // Initialize
    .init({
        resources,
        fallbackLng: 'en',

        // Default namespace
        defaultNS: 'common',

        // Namespaces to load
        ns: ['common', 'auth', 'trading', 'dashboard'],

        // Language detection order
        detection: {
            // Order of language detection
            order: ['localStorage', 'navigator', 'htmlTag'],
            // Cache user language preference
            caches: ['localStorage'],
            // localStorage key
            lookupLocalStorage: 'krystaline-language',
        },

        interpolation: {
            // React already escapes values
            escapeValue: false,
            // Format functions for dates, numbers, currencies
            format: (value, format, lng) => {
                if (format === 'currency') {
                    return new Intl.NumberFormat(lng, {
                        style: 'currency',
                        currency: 'USD',
                    }).format(value);
                }
                if (format === 'number') {
                    return new Intl.NumberFormat(lng).format(value);
                }
                if (value instanceof Date) {
                    return new Intl.DateTimeFormat(lng).format(value);
                }
                return value;
            },
        },

        // Development mode
        debug: process.env.NODE_ENV === 'development',

        react: {
            // Wait for translations to load before rendering
            useSuspense: true,
        },
    });

export default i18n;

// Export supported languages for the language switcher
export const supportedLanguages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    // { code: 'de', name: 'Deutsch', flag: '🇩🇪' },      // Phase 4
    // { code: 'fr', name: 'Français', flag: '🇫🇷' },    // Phase 4
    // { code: 'it', name: 'Italiano', flag: '🇮🇹' },    // Phase 4
    // { code: 'pt', name: 'Português', flag: '🇵🇹' },   // Phase 4
];

export type SupportedLanguage = 'en' | 'es'; // | 'de' | 'fr' | 'it' | 'pt';
