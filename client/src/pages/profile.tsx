import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Layout from "@/components/Layout";
import {
    User,
    Mail,
    Phone,
    Shield,
    Key,
    Laptop,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    RefreshCw,
    LogOut,
    Eye,
    EyeOff,
    Trash2,
    Smartphone,
    Copy
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UserProfile {
    id: string;
    email: string;
    phone?: string;
    status: string;
    kycLevel: number;
    createdAt: string;
    lastLoginAt?: string;
}

interface Session {
    id: string;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
    expiresAt: string;
    isCurrent: boolean;
}

export default function Profile() {
    const [, navigate] = useLocation();
    const { t } = useTranslation('auth');
    const [user, setUser] = useState<UserProfile | null>(null);
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPasswords, setShowPasswords] = useState(false);
    const [passwordError, setPasswordError] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState("");
    const queryClient = useQueryClient();

    // Get user from localStorage
    useEffect(() => {
        const storedUser = localStorage.getItem("user");
        if (!storedUser) {
            navigate("/login");
            return;
        }
        setUser(JSON.parse(storedUser));
    }, [navigate]);

    // Fetch user profile
    const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useQuery<UserProfile>({
        queryKey: ["/api/v1/auth/profile"],
        enabled: !!user,
    });

    // Fetch sessions
    const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useQuery<Session[]>({
        queryKey: ["/api/v1/auth/sessions"],
        enabled: !!user,
    });

    // Change password mutation
    const changePasswordMutation = useMutation({
        mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
            return apiRequest("POST", "/api/v1/auth/change-password", data);
        },
        onSuccess: () => {
            setPasswordSuccess("Password changed successfully!");
            setPasswordError("");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setShowPasswordForm(false);
        },
        onError: (error: Error) => {
            setPasswordError(error.message || "Failed to change password");
            setPasswordSuccess("");
        },
    });

    // Resend verification mutation
    const resendVerificationMutation = useMutation({
        mutationFn: async () => {
            return apiRequest("POST", "/api/v1/auth/resend-verification");
        },
        onSuccess: () => {
            alert("Verification email sent! Check your inbox.");
        },
        onError: (error: Error) => {
            alert(error.message || "Failed to send verification email");
        },
    });

    // Revoke session mutation
    const revokeSessionMutation = useMutation({
        mutationFn: async (sessionId: string) => {
            return apiRequest("DELETE", `/api/auth/sessions/${sessionId}`);
        },
        onSuccess: () => {
            refetchSessions();
        },
    });

    // Revoke all other sessions
    const revokeAllSessionsMutation = useMutation({
        mutationFn: async () => {
            return apiRequest("POST", "/api/v1/auth/sessions/revoke-all");
        },
        onSuccess: () => {
            refetchSessions();
        },
    });

    // 2FA State
    const [show2FASetup, setShow2FASetup] = useState(false);
    const [totpCode, setTotpCode] = useState("");
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    const [twoFactorError, setTwoFactorError] = useState("");

    // 2FA Status Query
    const { data: twoFactorStatus, refetch: refetch2FAStatus } = useQuery<{ enabled: boolean }>({
        queryKey: ["/api/v1/auth/2fa/status"],
        enabled: !!user,
    });

    // 2FA Setup Mutation
    const setup2FAMutation = useMutation({
        mutationFn: async () => {
            const response = await apiRequest("POST", "/api/v1/auth/2fa/setup");
            return response.json();  // Parse JSON from Response object
        },
        onSuccess: () => {
            setShow2FASetup(true);
            setTwoFactorError("");
        },
        onError: (error: Error) => {
            setTwoFactorError(error.message || "Failed to setup 2FA");
        },
    });

    // 2FA Verify Mutation  
    const verify2FAMutation = useMutation({
        mutationFn: async (code: string) => {
            const response = await apiRequest("POST", "/api/v1/auth/2fa/verify", { code });
            return response.json();  // Parse JSON from Response object
        },
        onSuccess: (data: any) => {
            if (data.backupCodes) {
                setBackupCodes(data.backupCodes);
            }
            refetch2FAStatus();
            setShow2FASetup(false);
            setTotpCode("");
            setTwoFactorError("");
        },
        onError: (error: Error) => {
            setTwoFactorError(error.message || "Invalid verification code");
        },
    });

    // 2FA Disable Mutation
    const disable2FAMutation = useMutation({
        mutationFn: async (password: string) => {
            return apiRequest("POST", "/api/v1/auth/2fa/disable", { password });
        },
        onSuccess: () => {
            refetch2FAStatus();
            setBackupCodes([]);
            setTwoFactorError("");
        },
        onError: (error: Error) => {
            setTwoFactorError(error.message || "Failed to disable 2FA");
        },
    });

    const handleDisable2FA = () => {
        const password = prompt("Enter your password to disable 2FA:");
        if (password) {
            disable2FAMutation.mutate(password);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError("");

        if (newPassword !== confirmPassword) {
            setPasswordError("Passwords do not match");
            return;
        }

        if (newPassword.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }

        changePasswordMutation.mutate({ currentPassword, newPassword });
    };

    const getStatusBadge = (status: string) => {
        const config: Record<string, { color: string; icon: React.ReactNode }> = {
            'verified': { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: <CheckCircle2 className="w-3 h-3" /> },
            'pending': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: <Clock className="w-3 h-3" /> },
            'suspended': { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: <XCircle className="w-3 h-3" /> },
            'kyc_pending': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: <AlertCircle className="w-3 h-3" /> },
            'kyc_verified': { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: <Shield className="w-3 h-3" /> },
        };
        const { color, icon } = config[status] || config['pending'];
        return (
            <Badge variant="outline" className={color}>
                {icon}
                <span className="ml-1 capitalize">{status.replace('_', ' ')}</span>
            </Badge>
        );
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const parseUserAgent = (ua?: string) => {
        if (!ua) return { browser: 'Unknown', os: 'Unknown' };
        const browser = ua.includes('Chrome') ? 'Chrome' :
            ua.includes('Firefox') ? 'Firefox' :
                ua.includes('Safari') ? 'Safari' : 'Other';
        const os = ua.includes('Windows') ? 'Windows' :
            ua.includes('Mac') ? 'macOS' :
                ua.includes('Linux') ? 'Linux' : 'Other';
        return { browser, os };
    };

    if (!user) return null;

    const displayProfile = profile || user;

    return (
        <Layout>
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-4 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl">
                        <User className="w-10 h-10 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-cyan-100">{t('profile.title')}</h1>
                        <p className="text-cyan-100/60">{t('profile.twoFactorDescription')}</p>
                    </div>
                </div>

                <div className="grid gap-6">
                    {/* Account Information */}
                    <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-cyan-500/20">
                        <CardHeader>
                            <CardTitle className="text-cyan-100 flex items-center gap-2">
                                <Mail className="w-5 h-5 text-cyan-400" />
                                {t('profile.accountInfo')}
                            </CardTitle>
                            <CardDescription className="text-cyan-100/50">
                                Your personal account details
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-cyan-100/70">Email</Label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-slate-900/50 border border-cyan-500/20 rounded-lg px-4 py-2 text-cyan-100">
                                            {displayProfile.email}
                                        </div>
                                        {displayProfile.status === 'verified' || displayProfile.status === 'kyc_verified' ? (
                                            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                                Verified
                                            </Badge>
                                        ) : (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => resendVerificationMutation.mutate()}
                                                disabled={resendVerificationMutation.isPending}
                                                className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                                            >
                                                <RefreshCw className={`w-4 h-4 mr-2 ${resendVerificationMutation.isPending ? 'animate-spin' : ''}`} />
                                                Verify
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-cyan-100/70">Phone</Label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-slate-900/50 border border-cyan-500/20 rounded-lg px-4 py-2 text-cyan-100/50">
                                            {displayProfile.phone || 'Not set'}
                                        </div>
                                        {!displayProfile.phone && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                                            >
                                                <Phone className="w-4 h-4 mr-2" />
                                                Add
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 pt-4 border-t border-cyan-500/10">
                                <div className="flex items-center gap-2">
                                    <span className="text-cyan-100/50 text-sm">Status:</span>
                                    {getStatusBadge(displayProfile.status)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-cyan-100/50 text-sm">KYC Level:</span>
                                    <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                                        Level {displayProfile.kycLevel}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Security - Change Password */}
                    <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-cyan-500/20">
                        <CardHeader>
                            <CardTitle className="text-cyan-100 flex items-center gap-2">
                                <Key className="w-5 h-5 text-cyan-400" />
                                Security
                            </CardTitle>
                            <CardDescription className="text-cyan-100/50">
                                Manage your password and security settings
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!showPasswordForm ? (
                                <Button
                                    onClick={() => setShowPasswordForm(true)}
                                    className="bg-cyan-600 hover:bg-cyan-700"
                                >
                                    <Key className="w-4 h-4 mr-2" />
                                    Change Password
                                </Button>
                            ) : (
                                <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                                    {passwordError && (
                                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm">
                                            {passwordError}
                                        </div>
                                    )}
                                    {passwordSuccess && (
                                        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded-lg text-sm">
                                            {passwordSuccess}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <Label className="text-cyan-100/70">Current Password</Label>
                                        <div className="relative">
                                            <Input
                                                type={showPasswords ? "text" : "password"}
                                                value={currentPassword}
                                                onChange={(e) => setCurrentPassword(e.target.value)}
                                                className="bg-slate-900/50 border-cyan-500/20 text-cyan-100 pr-10"
                                                required
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPasswords(!showPasswords)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-100/50 hover:text-cyan-100"
                                            >
                                                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-cyan-100/70">New Password</Label>
                                        <Input
                                            type={showPasswords ? "text" : "password"}
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className="bg-slate-900/50 border-cyan-500/20 text-cyan-100"
                                            required
                                            minLength={8}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-cyan-100/70">Confirm New Password</Label>
                                        <Input
                                            type={showPasswords ? "text" : "password"}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="bg-slate-900/50 border-cyan-500/20 text-cyan-100"
                                            required
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <Button
                                            type="submit"
                                            disabled={changePasswordMutation.isPending}
                                            className="bg-cyan-600 hover:bg-cyan-700"
                                        >
                                            {changePasswordMutation.isPending ? 'Saving...' : 'Update Password'}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setShowPasswordForm(false)}
                                            className="border-cyan-500/30 text-cyan-100 hover:bg-cyan-500/10"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </form>
                            )}
                        </CardContent>
                    </Card>

                    {/* Two-Factor Authentication */}
                    <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-cyan-500/20">
                        <CardHeader>
                            <CardTitle className="text-cyan-100 flex items-center gap-2">
                                <Smartphone className="w-5 h-5 text-cyan-400" />
                                Two-Factor Authentication
                            </CardTitle>
                            <CardDescription className="text-cyan-100/50">
                                Add an extra layer of security to your account
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {twoFactorError && (
                                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm">
                                    {twoFactorError}
                                </div>
                            )}

                            {twoFactorStatus?.enabled ? (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-500/20 rounded-lg">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="text-cyan-100 font-medium">2FA is enabled</p>
                                            <p className="text-cyan-100/50 text-sm">Your account is protected with TOTP authentication</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={handleDisable2FA}
                                        disabled={disable2FAMutation.isPending}
                                        className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                    >
                                        {disable2FAMutation.isPending ? 'Disabling...' : 'Disable 2FA'}
                                    </Button>
                                </div>
                            ) : show2FASetup && setup2FAMutation.data ? (
                                <div className="space-y-4">
                                    <div className="flex flex-col md:flex-row gap-6">
                                        <div className="flex-shrink-0">
                                            <img
                                                src={(setup2FAMutation.data as any).qrCode}
                                                alt="QR Code"
                                                className="w-48 h-48 rounded-lg border border-cyan-500/20"
                                            />
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-cyan-100 font-medium">Scan QR Code</p>
                                                <p className="text-cyan-100/50 text-sm">
                                                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-cyan-100/50 text-sm mb-1">Or enter manually:</p>
                                                <div className="flex items-center gap-2">
                                                    <code className="bg-slate-800 px-3 py-1. rounded text-cyan-400 text-sm font-mono">
                                                        {(setup2FAMutation.data as any).secret}
                                                    </code>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => copyToClipboard((setup2FAMutation.data as any).secret)}
                                                        className="text-cyan-400 hover:bg-cyan-500/10"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-cyan-100/70">Enter verification code</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        type="text"
                                                        placeholder="000000"
                                                        value={totpCode}
                                                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                        className="bg-slate-900/50 border-cyan-500/20 text-cyan-100 w-32 text-center font-mono tracking-widest"
                                                        maxLength={6}
                                                    />
                                                    <Button
                                                        onClick={() => verify2FAMutation.mutate(totpCode)}
                                                        disabled={totpCode.length !== 6 || verify2FAMutation.isPending}
                                                        className="bg-cyan-600 hover:bg-cyan-700"
                                                    >
                                                        {verify2FAMutation.isPending ? 'Verifying...' : 'Enable 2FA'}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        onClick={() => setShow2FASetup(false)}
                                        className="text-cyan-100/50 hover:text-cyan-100"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <p className="text-cyan-100/70 text-sm">
                                        Protect your account with time-based one-time passwords (TOTP).
                                        You'll need an authenticator app like Google Authenticator or Authy.
                                    </p>
                                    <Button
                                        onClick={() => setup2FAMutation.mutate()}
                                        disabled={setup2FAMutation.isPending}
                                        className="bg-cyan-600 hover:bg-cyan-700"
                                    >
                                        <Shield className="w-4 h-4 mr-2" />
                                        {setup2FAMutation.isPending ? 'Setting up...' : 'Set Up 2FA'}
                                    </Button>
                                </div>
                            )}

                            {/* Backup Codes Display */}
                            {backupCodes.length > 0 && (
                                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                    <h4 className="text-yellow-400 font-medium mb-2 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4" />
                                        Save Your Backup Codes
                                    </h4>
                                    <p className="text-yellow-400/70 text-sm mb-3">
                                        These codes can be used to access your account if you lose your authenticator.
                                        Each code can only be used once.
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {backupCodes.map((code, index) => (
                                            <code key={index} className="bg-slate-800 px-2 py-1 rounded text-cyan-400 text-sm font-mono text-center">
                                                {code}
                                            </code>
                                        ))}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(backupCodes.join('\n'))}
                                        className="mt-3 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                                    >
                                        <Copy className="w-4 h-4 mr-2" />
                                        Copy All Codes
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Active Sessions */}
                    <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-cyan-500/20">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-cyan-100 flex items-center gap-2">
                                    <Laptop className="w-5 h-5 text-cyan-400" />
                                    Active Sessions
                                </CardTitle>
                                <CardDescription className="text-cyan-100/50">
                                    Devices where you're currently logged in
                                </CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => revokeAllSessionsMutation.mutate()}
                                disabled={revokeAllSessionsMutation.isPending}
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                Sign Out All
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {sessionsLoading ? (
                                <div className="space-y-3">
                                    {[1, 2].map((i) => (
                                        <div key={i} className="h-20 bg-slate-700/50 rounded-lg animate-pulse" />
                                    ))}
                                </div>
                            ) : sessions && sessions.length > 0 ? (
                                <div className="space-y-3">
                                    {sessions.map((session) => {
                                        const { browser, os } = parseUserAgent(session.userAgent);
                                        return (
                                            <div
                                                key={session.id}
                                                className={`flex items-center justify-between p-4 rounded-lg border ${session.isCurrent
                                                    ? 'bg-cyan-500/10 border-cyan-500/30'
                                                    : 'bg-slate-900/50 border-cyan-500/10'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="p-2 bg-slate-800 rounded-lg">
                                                        <Laptop className="w-5 h-5 text-cyan-400" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-cyan-100 flex items-center gap-2">
                                                            {browser} on {os}
                                                            {session.isCurrent && (
                                                                <Badge variant="outline" className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                                                                    Current
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-cyan-100/50">
                                                            {session.ipAddress || 'Unknown IP'} • {formatDate(session.createdAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                                {!session.isCurrent && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => revokeSessionMutation.mutate(session.id)}
                                                        disabled={revokeSessionMutation.isPending}
                                                        className="text-red-400 hover:bg-red-500/10"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-cyan-100/50">
                                    <Laptop className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                    <p>No active sessions found</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </Layout>
    );
}
