import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Layout from "@/components/Layout";

// ============================================
// Types
// ============================================

interface TradeStat {
    pair: string;
    side: string;
    count: number;
    volume: number;
    valueUsd: number;
}

interface VolumeByPair {
    pair: string;
    volume: number;
    valueUsd: number;
    buyVolume: number;
    sellVolume: number;
}

interface BusinessStats {
    activeUsers: number;
    tradesToday: TradeStat[];
    totalTradesToday: number;
    volumeByPair: VolumeByPair[];
    totalVolumeUsd: number;
    lastUpdated: string;
}

interface ActivityItem {
    userId: string;
    email: string;
    lastActivity: string;
    activityType: string;
}

// ============================================
// Helper Functions
// ============================================

function formatCurrency(value: number): string {
    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
        return `$${(value / 1_000).toFixed(2)}K`;
    }
    return `$${value.toFixed(2)}`;
}

function formatNumber(value: number, decimals: number = 2): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(decimals)}M`;
    } else if (value >= 1_000) {
        return `${(value / 1_000).toFixed(decimals)}K`;
    }
    return value.toFixed(decimals);
}

function formatBTC(value: number): string {
    if (value >= 1) {
        return `${value.toFixed(4)} BTC`;
    }
    return `${(value * 100_000_000).toFixed(0)} sats`;
}

// ============================================
// Component
// ============================================

export default function Admin() {
    const [timezoneOffset] = useState(() => new Date().getTimezoneOffset());

    // Fetch business stats with auto-refresh
    const { data: statsData, isLoading: statsLoading } = useQuery<BusinessStats>({
        queryKey: ["/api/v1/monitor/admin/stats", { tz: timezoneOffset }],
        queryFn: async () => {
            const res = await fetch(`/api/v1/monitor/admin/stats?tz=${timezoneOffset}`);
            return res.json();
        },
        refetchInterval: 30_000, // Refresh every 30 seconds
    });

    // Fetch recent activity
    const { data: activityData } = useQuery<{ activity: ActivityItem[]; count: number }>({
        queryKey: ["/api/v1/monitor/admin/activity"],
        refetchInterval: 15_000, // Refresh every 15 seconds
    });

    // Calculate aggregates for display
    const buyTrades = statsData?.tradesToday.filter(t => t.side === 'BUY') || [];
    const sellTrades = statsData?.tradesToday.filter(t => t.side === 'SELL') || [];
    const totalBuys = buyTrades.reduce((sum, t) => sum + t.count, 0);
    const totalSells = sellTrades.reduce((sum, t) => sum + t.count, 0);
    const buyVolume = buyTrades.reduce((sum, t) => sum + t.volume, 0);
    const sellVolume = sellTrades.reduce((sum, t) => sum + t.volume, 0);

    return (
        <Layout>
            <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-cyan-100 p-6 sm:p-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                            Business Dashboard
                        </h1>
                        <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-500/30 text-sm px-3 py-1">
                            LIVE
                        </Badge>
                    </div>
                    {statsData?.lastUpdated && (
                        <span className="text-sm text-cyan-400/70">
                            Last updated: {new Date(statsData.lastUpdated).toLocaleTimeString()}
                        </span>
                    )}
                </div>

                {/* Top Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {/* Active Users */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-cyan-400/70 text-sm font-medium">Active Users</p>
                                    <p className="text-4xl font-bold text-white mt-1">
                                        {statsLoading ? '...' : statsData?.activeUsers || 0}
                                    </p>
                                    <p className="text-cyan-400/50 text-xs mt-1">Last 15 min</p>
                                </div>
                                <div className="h-14 w-14 rounded-full bg-cyan-500/20 flex items-center justify-center">
                                    <span className="text-2xl">👥</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Trades Today */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-cyan-400/70 text-sm font-medium">Trades Today</p>
                                    <p className="text-4xl font-bold text-white mt-1">
                                        {statsLoading ? '...' : statsData?.totalTradesToday || 0}
                                    </p>
                                    <p className="text-cyan-400/50 text-xs mt-1">
                                        Since midnight
                                    </p>
                                </div>
                                <div className="h-14 w-14 rounded-full bg-purple-500/20 flex items-center justify-center">
                                    <span className="text-2xl">📈</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Total Volume */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-cyan-400/70 text-sm font-medium">Volume Today</p>
                                    <p className="text-4xl font-bold text-emerald-400 mt-1">
                                        {statsLoading ? '...' : formatCurrency(statsData?.totalVolumeUsd || 0)}
                                    </p>
                                    <p className="text-cyan-400/50 text-xs mt-1">
                                        {formatBTC(buyVolume + sellVolume)} traded
                                    </p>
                                </div>
                                <div className="h-14 w-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                    <span className="text-2xl">💰</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Buy/Sell Ratio */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-cyan-400/70 text-sm font-medium">Buy / Sell</p>
                                    <p className="text-4xl font-bold mt-1">
                                        <span className="text-emerald-400">{totalBuys}</span>
                                        <span className="text-slate-500 mx-2">/</span>
                                        <span className="text-red-400">{totalSells}</span>
                                    </p>
                                    <p className="text-cyan-400/50 text-xs mt-1">
                                        {totalBuys + totalSells > 0
                                            ? `${((totalBuys / (totalBuys + totalSells)) * 100).toFixed(0)}% buys`
                                            : 'No trades yet'}
                                    </p>
                                </div>
                                <div className="h-14 w-14 rounded-full bg-amber-500/20 flex items-center justify-center">
                                    <span className="text-2xl">⚖️</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Main Content Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Volume by Pair */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl lg:col-span-2">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-cyan-100 text-xl font-semibold">Volume by Trading Pair</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {statsData?.volumeByPair && statsData.volumeByPair.length > 0 ? (
                                <div className="space-y-4">
                                    {statsData.volumeByPair.map((pair) => {
                                        const maxVolume = Math.max(...statsData.volumeByPair.map(p => p.valueUsd));
                                        const percentage = maxVolume > 0 ? (pair.valueUsd / maxVolume) * 100 : 0;

                                        return (
                                            <div key={pair.pair} className="bg-slate-900/50 rounded-lg p-4 border border-cyan-500/20">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-mono text-lg text-white font-semibold">{pair.pair}</span>
                                                    <span className="text-xl font-bold text-emerald-400">
                                                        {formatCurrency(pair.valueUsd)}
                                                    </span>
                                                </div>

                                                {/* Progress bar */}
                                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>

                                                {/* Buy/Sell breakdown */}
                                                <div className="flex justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                                        <span className="text-slate-400">Buy:</span>
                                                        <span className="text-emerald-400 font-medium">{formatBTC(pair.buyVolume)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="h-2 w-2 rounded-full bg-red-500" />
                                                        <span className="text-slate-400">Sell:</span>
                                                        <span className="text-red-400 font-medium">{formatBTC(pair.sellVolume)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-slate-400 text-center py-10">
                                    {statsLoading ? 'Loading...' : 'No trades recorded today'}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Recent Activity */}
                    <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-cyan-100 text-xl font-semibold flex items-center gap-3">
                                Recent Activity
                                {activityData?.count && activityData.count > 0 && (
                                    <Badge className="bg-cyan-600/20 text-cyan-400 border-cyan-500/30">
                                        {activityData.count} active
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3 max-h-80 overflow-y-auto">
                                {activityData?.activity && activityData.activity.length > 0 ? (
                                    activityData.activity.map((item, index) => (
                                        <div
                                            key={`${item.userId}-${index}`}
                                            className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-cyan-500/20"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                                                    {item.email.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-white text-sm font-medium truncate max-w-[120px]">
                                                        {item.email.split('@')[0]}
                                                    </div>
                                                    <div className="text-cyan-400/50 text-xs">
                                                        {item.activityType === 'trade' ? '📈 Trade' : '🔐 Session'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-slate-400 text-xs">
                                                {new Date(item.lastActivity).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-slate-400 text-center py-8">
                                        No recent activity
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Trades Breakdown Table */}
                <Card className="bg-slate-800/50 backdrop-blur border-cyan-500/30 shadow-xl mt-6">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-cyan-100 text-xl font-semibold">Today's Trade Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {statsData?.tradesToday && statsData.tradesToday.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-slate-700">
                                            <th className="text-left py-3 px-4 text-cyan-400/70 font-medium">Pair</th>
                                            <th className="text-left py-3 px-4 text-cyan-400/70 font-medium">Side</th>
                                            <th className="text-right py-3 px-4 text-cyan-400/70 font-medium">Count</th>
                                            <th className="text-right py-3 px-4 text-cyan-400/70 font-medium">Volume</th>
                                            <th className="text-right py-3 px-4 text-cyan-400/70 font-medium">Value (USD)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {statsData.tradesToday.map((trade, index) => (
                                            <tr
                                                key={`${trade.pair}-${trade.side}-${index}`}
                                                className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                                            >
                                                <td className="py-3 px-4 font-mono text-white">{trade.pair}</td>
                                                <td className="py-3 px-4">
                                                    <Badge className={`${trade.side === 'BUY'
                                                            ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                                                            : 'bg-red-600/20 text-red-400 border-red-500/30'
                                                        }`}>
                                                        {trade.side}
                                                    </Badge>
                                                </td>
                                                <td className="py-3 px-4 text-right text-white font-semibold">{trade.count}</td>
                                                <td className="py-3 px-4 text-right text-slate-300">{formatBTC(trade.volume)}</td>
                                                <td className="py-3 px-4 text-right text-emerald-400 font-semibold">
                                                    {formatCurrency(trade.valueUsd)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-cyan-500/30">
                                            <td colSpan={2} className="py-3 px-4 font-semibold text-cyan-100">Total</td>
                                            <td className="py-3 px-4 text-right text-white font-bold">
                                                {statsData.totalTradesToday}
                                            </td>
                                            <td className="py-3 px-4 text-right text-slate-300 font-semibold">
                                                {formatBTC(buyVolume + sellVolume)}
                                            </td>
                                            <td className="py-3 px-4 text-right text-emerald-400 font-bold text-lg">
                                                {formatCurrency(statsData.totalVolumeUsd)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div className="text-slate-400 text-center py-10">
                                {statsLoading ? 'Loading trade data...' : 'No trades recorded today. Execute some trades to see stats!'}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </Layout>
    );
}
