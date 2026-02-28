/**
 * Language Switcher Component
 * 
 * Dropdown to change the application language.
 * Persists selection to localStorage.
 */

import { useTranslation } from 'react-i18next';
import { supportedLanguages, SupportedLanguage } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
    const { i18n } = useTranslation();

    const currentLanguage = supportedLanguages.find(
        (lang) => lang.code === i18n.language
    ) || supportedLanguages[0];

    const handleLanguageChange = (langCode: SupportedLanguage) => {
        i18n.changeLanguage(langCode);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-3 text-cyan-100/70 hover:text-cyan-100 hover:bg-cyan-500/10"
                >
                    <Globe className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">{currentLanguage.flag} {currentLanguage.name}</span>
                    <span className="sm:hidden">{currentLanguage.flag}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="bg-slate-900 border-cyan-500/20"
            >
                {supportedLanguages.map((lang) => (
                    <DropdownMenuItem
                        key={lang.code}
                        onClick={() => handleLanguageChange(lang.code as SupportedLanguage)}
                        className={`cursor-pointer ${lang.code === i18n.language
                                ? 'bg-cyan-500/20 text-cyan-100'
                                : 'text-cyan-100/70 hover:text-cyan-100 hover:bg-cyan-500/10'
                            }`}
                    >
                        <span className="mr-2">{lang.flag}</span>
                        {lang.name}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default LanguageSwitcher;
