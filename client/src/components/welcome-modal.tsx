/**
 * Welcome Modal Component
 * 
 * Shown once after first login to guide new users to make their first trade.
 * Emphasizes "Proof of Observability" - the unique value proposition.
 * 
 * Uses localStorage to track if the user has seen this modal.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles, Eye, Zap, ArrowRight, Shield, CheckCircle2 } from 'lucide-react';

interface WelcomeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const STORAGE_KEY = 'krystaline_welcome_shown';

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
    const [, navigate] = useLocation();
    const { t } = useTranslation('dashboard');
    const [step, setStep] = useState(0);

    const handleStartTrading = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        onClose();
        navigate('/trade?welcome=true');
    };

    const handleSkip = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        onClose();
    };

    const steps = [
        {
            icon: Sparkles,
            color: 'from-purple-500 to-pink-500',
            titleKey: 'welcome.step1Title',
            descriptionKey: 'welcome.step1Subtitle',
            highlight: t('welcome.step1Subtitle'),
        },
        {
            icon: Eye,
            color: 'from-cyan-500 to-blue-500',
            titleKey: 'welcome.step2Title',
            descriptionKey: 'welcome.step2Subtitle',
            highlight: t('welcome.step2Subtitle'),
        },
        {
            icon: Shield,
            color: 'from-emerald-500 to-cyan-500',
            titleKey: 'welcome.step3Title',
            descriptionKey: 'welcome.step3Subtitle',
            highlight: t('welcome.step3Subtitle'),
        },
    ];

    const currentStep = steps[step];
    const Icon = currentStep.icon;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border-cyan-500/30">
                <DialogHeader className="space-y-4">
                    {/* Progress dots */}
                    <div className="flex justify-center gap-2">
                        {steps.map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all duration-300 ${i === step
                                    ? 'w-6 bg-gradient-to-r from-cyan-400 to-blue-500'
                                    : i < step
                                        ? 'w-2 bg-cyan-400'
                                        : 'w-2 bg-slate-600'
                                    }`}
                            />
                        ))}
                    </div>

                    {/* Icon */}
                    <div className="flex justify-center pt-4">
                        <div className={`p-4 rounded-2xl bg-gradient-to-br ${currentStep.color} shadow-xl`}>
                            <Icon className="w-8 h-8 text-white" />
                        </div>
                    </div>

                    <DialogTitle className="text-2xl font-bold text-center text-cyan-100">
                        {t(currentStep.titleKey)}
                    </DialogTitle>

                    <DialogDescription className="text-center space-y-3">
                        <p className="text-cyan-400 font-semibold text-base">
                            {currentStep.highlight}
                        </p>
                    </DialogDescription>
                </DialogHeader>

                {/* Journey Preview on last step */}
                {step === 2 && (
                    <div className="py-4">
                        <div className="flex items-center justify-between">
                            {[t('common:nav.trade'), 'Trace', 'Verify'].map((label, i) => (
                                <div key={label} className="flex items-center">
                                    <div className="flex flex-col items-center">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${i === 0 ? 'bg-cyan-500/20 border-2 border-cyan-400' :
                                            i === 1 ? 'bg-purple-500/20 border-2 border-purple-400' :
                                                'bg-emerald-500/20 border-2 border-emerald-400'
                                            }`}>
                                            <CheckCircle2 className={`w-5 h-5 ${i === 0 ? 'text-cyan-400' :
                                                i === 1 ? 'text-purple-400' :
                                                    'text-emerald-400'
                                                }`} />
                                        </div>
                                        <span className="text-sm text-slate-400 mt-2">{label}</span>
                                    </div>
                                    {i < 2 && (
                                        <div className="w-12 h-px bg-gradient-to-r from-slate-600 to-slate-700 mx-2" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3 pt-4">
                    {step < 2 ? (
                        <>
                            <Button
                                onClick={() => setStep(step + 1)}
                                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold"
                            >
                                {t('common:buttons.next')}
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={handleSkip}
                                className="text-slate-400 hover:text-slate-300"
                            >
                                {t('welcome.skipTour')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                onClick={handleStartTrading}
                                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold py-6 text-lg group"
                            >
                                <Zap className="w-5 h-5 mr-2 group-hover:animate-pulse" />
                                {t('portfolio.firstTrade.cta')}
                                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={handleSkip}
                                className="text-slate-400 hover:text-slate-300"
                            >
                                {t('welcome.skipTour')}
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Hook to manage welcome modal state
 */
export function useWelcomeModal() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Check if user is new and hasn't seen the modal
        const isNewUser = localStorage.getItem('isNewUser') === 'true';
        const hasSeenWelcome = localStorage.getItem(STORAGE_KEY) === 'true';

        if (isNewUser && !hasSeenWelcome) {
            // Small delay for better UX
            const timer = setTimeout(() => setIsOpen(true), 500);
            return () => clearTimeout(timer);
        }
    }, []);

    const close = () => setIsOpen(false);
    const open = () => setIsOpen(true);

    return { isOpen, close, open };
}
