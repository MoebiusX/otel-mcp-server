import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Layout from "@/components/Layout";

interface Wallet {
    asset: string;
    balance: string;
    available: string;
}

interface Quote {
    fromAsset: string;
    toAsset: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    fee: number;
}

const ASSETS = ['BTC', 'ETH', 'USDT', 'USD', 'EUR'];

const ASSET_CONFIG: Record<string, { icon: string; color: string }> = {
    BTC: { icon: "₿", color: "text-orange-400" },
    ETH: { icon: "Ξ", color: "text-purple-400" },
    USDT: { icon: "₮", color: "text-emerald-400" },
    USD: { icon: "$", color: "text-green-400" },
    EUR: { icon: "€", color: "text-blue-400" },
};

export default function Convert() {
    const [, setLocation] = useLocation();
    const { t } = useTranslation(['common', 'trading']);
    const [fromAsset, setFromAsset] = useState("USDT");
    const [toAsset, setToAsset] = useState("BTC");
    const [amount, setAmount] = useState("");
    const [quote, setQuote] = useState<Quote | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    // Check auth
    useEffect(() => {
        if (!localStorage.getItem("accessToken")) {
            setLocation("/login");
        }
    }, [setLocation]);

    // Fetch wallets
    const { data: walletsData } = useQuery<{ wallets: Wallet[] }>({
        queryKey: ["/api/v1/wallet/balances"],
        queryFn: async () => {
            const token = localStorage.getItem("accessToken");
            const res = await fetch("/api/v1/wallet/balances", {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
    });

    // Get quote mutation
    const quoteMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem("accessToken");
            const res = await fetch("/api/v1/trade/convert/quote", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    fromAsset,
                    toAsset,
                    amount: parseFloat(amount),
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to get quote");
            }
            return res.json();
        },
        onSuccess: (data) => {
            setQuote(data.quote);
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message);
            setQuote(null);
        },
    });

    // Execute convert mutation
    const convertMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem("accessToken");
            const res = await fetch("/api/v1/trade/convert", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    fromAsset,
                    toAsset,
                    amount: parseFloat(amount),
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Conversion failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            setSuccess(data.message);
            setQuote(null);
            setAmount("");
            setError("");
            // Refetch wallets
            setTimeout(() => setSuccess(""), 5000);
        },
        onError: (err: Error) => {
            setError(err.message);
        },
    });

    // Get quote when amount changes
    useEffect(() => {
        const timer = setTimeout(() => {
            if (amount && parseFloat(amount) > 0 && fromAsset !== toAsset) {
                quoteMutation.mutate();
            } else {
                setQuote(null);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [amount, fromAsset, toAsset]);

    const getBalance = (asset: string) => {
        const wallet = walletsData?.wallets?.find(w => w.asset === asset);
        return wallet ? parseFloat(wallet.available) : 0;
    };

    const handleSwap = () => {
        setFromAsset(toAsset);
        setToAsset(fromAsset);
        setAmount("");
        setQuote(null);
    };

    const handleMaxClick = () => {
        const balance = getBalance(fromAsset);
        setAmount(balance.toString());
    };

    return (
        <Layout>
            <div className="container mx-auto px-4 py-8 max-w-lg">
                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader>
                        <CardTitle className="text-2xl text-white flex items-center gap-2">
                            🔄 {t('common:nav.convert')}
                            <span className="text-sm font-normal text-slate-400">{t('trading:convert.instant')}</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        {success && (
                            <Alert className="bg-emerald-900/50 border-emerald-700 text-emerald-400">
                                <AlertDescription>✅ {success}</AlertDescription>
                            </Alert>
                        )}

                        {/* From Asset */}
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label className="text-slate-300">From</Label>
                                <span className="text-sm text-slate-400">
                                    Available: {getBalance(fromAsset).toLocaleString()} {fromAsset}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <Input
                                        type="number"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="bg-slate-900 border-slate-700 text-white text-xl h-14 pr-16"
                                    />
                                    <button
                                        onClick={handleMaxClick}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-400 text-sm hover:text-purple-300"
                                    >
                                        MAX
                                    </button>
                                </div>
                                <select
                                    value={fromAsset}
                                    onChange={(e) => setFromAsset(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 rounded-md px-4 text-white h-14 min-w-[100px]"
                                >
                                    {ASSETS.filter(a => a !== toAsset).map(asset => (
                                        <option key={asset} value={asset}>
                                            {ASSET_CONFIG[asset]?.icon} {asset}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Swap Button */}
                        <div className="flex justify-center">
                            <button
                                onClick={handleSwap}
                                className="p-3 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
                            >
                                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                </svg>
                            </button>
                        </div>

                        {/* To Asset */}
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label className="text-slate-300">To</Label>
                                <span className="text-sm text-slate-400">
                                    Balance: {getBalance(toAsset).toLocaleString()} {toAsset}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <Input
                                        type="text"
                                        value={quote ? quote.toAmount.toFixed(8) : "0.00"}
                                        readOnly
                                        className="bg-slate-900/50 border-slate-700 text-white text-xl h-14"
                                    />
                                </div>
                                <select
                                    value={toAsset}
                                    onChange={(e) => setToAsset(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 rounded-md px-4 text-white h-14 min-w-[100px]"
                                >
                                    {ASSETS.filter(a => a !== fromAsset).map(asset => (
                                        <option key={asset} value={asset}>
                                            {ASSET_CONFIG[asset]?.icon} {asset}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Quote Details */}
                        {quote && (
                            <div className="bg-slate-900/50 rounded-lg p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Rate</span>
                                    <span className="text-white">
                                        1 {fromAsset} = {quote.rate.toFixed(8)} {toAsset}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Fee (0.1%)</span>
                                    <span className="text-white">
                                        {quote.fee.toFixed(8)} {toAsset}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm pt-2 border-t border-slate-700">
                                    <span className="text-slate-400">You'll receive</span>
                                    <span className="text-emerald-400 font-bold">
                                        {quote.toAmount.toFixed(8)} {toAsset}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Convert Button */}
                        <Button
                            onClick={() => convertMutation.mutate()}
                            disabled={!quote || convertMutation.isPending}
                            className="w-full h-14 text-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
                        >
                            {convertMutation.isPending ? (
                                "Converting..."
                            ) : quoteMutation.isPending ? (
                                "Getting quote..."
                            ) : quote ? (
                                `Convert ${amount} ${fromAsset} → ${toAsset}`
                            ) : (
                                "Enter amount to convert"
                            )}
                        </Button>

                        <p className="text-center text-xs text-slate-500">
                            Powered by Krystaline • Crystal Clear Crypto
                        </p>
                    </CardContent>
                </Card>
            </div>
        </Layout>
    );
}
