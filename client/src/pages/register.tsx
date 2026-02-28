import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Register() {
    const [, setLocation] = useLocation();
    const { t } = useTranslation('auth');
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [step, setStep] = useState<"register" | "verify">("register");
    const [verificationCode, setVerificationCode] = useState("");

    const registerMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch("/api/v1/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || data.details?.join(", ") || "Registration failed");
            }
            return res.json();
        },
        onSuccess: () => {
            setStep("verify");
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message);
        },
    });

    const verifyMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch("/api/v1/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code: verificationCode }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Verification failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            // Store tokens
            localStorage.setItem("accessToken", data.tokens.accessToken);
            localStorage.setItem("refreshToken", data.tokens.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.user));
            // Mark as new user for welcome experience
            localStorage.setItem("isNewUser", "true");
            // Redirect to trade page with welcome experience
            setLocation("/trade?welcome=true");
        },
        onError: (err: Error) => {
            setError(err.message);
        },
    });

    const handleRegister = (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        registerMutation.mutate();
    };

    const handleVerify = (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        verifyMutation.mutate();
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 flex items-center justify-center p-4">
            {/* Back to Home */}
            <a href="/" className="absolute top-6 left-6 flex items-center gap-2 text-cyan-100/70 hover:text-cyan-100 transition-colors group">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:-translate-x-1 transition-transform"><path d="m15 18-6-6 6-6" /></svg>
                <span className="text-sm font-medium">{t('login.backToHome')}</span>
            </a>

            <Card className="w-full max-w-md bg-slate-900/80 border-cyan-500/20 backdrop-blur-xl shadow-2xl">
                <CardHeader className="text-center">
                    <CardTitle className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                        {step === "register" ? t('register.title') : t('verify.title')}
                    </CardTitle>
                    <CardDescription className="text-cyan-100/60">
                        {step === "register"
                            ? t('register.subtitle')
                            : t('verify.subtitle', { email })}
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    {error && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {step === "register" ? (
                        <form onSubmit={handleRegister} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-cyan-100">{t('register.email')}</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder={t('login.emailPlaceholder')}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="bg-slate-800/50 border-cyan-500/30 text-cyan-100 placeholder:text-cyan-100/30"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-cyan-100">{t('register.password')}</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder={t('register.passwordRequirements')}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="bg-slate-800/50 border-cyan-500/30 text-cyan-100 placeholder:text-cyan-100/30"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword" className="text-cyan-100">{t('register.confirmPassword')}</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    placeholder={t('register.confirmPassword')}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    className="bg-slate-800/50 border-cyan-500/30 text-cyan-100 placeholder:text-cyan-100/30"
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25"
                                disabled={registerMutation.isPending}
                            >
                                {registerMutation.isPending ? t('register.submitting') : t('register.submit')}
                            </Button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerify} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="code" className="text-cyan-100">{t('verify.code')}</Label>
                                <Input
                                    id="code"
                                    type="text"
                                    placeholder="000000"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value)}
                                    maxLength={6}
                                    required
                                    className="bg-slate-800/50 border-cyan-500/30 text-cyan-100 text-center text-2xl tracking-widest placeholder:text-cyan-100/30"
                                />
                                <p className="text-sm text-cyan-100/60 text-center">
                                    Check your email or view at <a href={import.meta.env.VITE_MAILDEV_URL || "http://localhost:1080"} target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">Mail Inbox</a>
                                </p>
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25"
                                disabled={verifyMutation.isPending}
                            >
                                {verifyMutation.isPending ? t('verify.submitting') : t('verify.submit')}
                            </Button>
                        </form>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col gap-2">
                    <div className="text-sm text-cyan-100/60">
                        {t('register.hasAccount')}{" "}
                        <a href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">
                            {t('register.signIn')}
                        </a>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
}
