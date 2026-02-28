/**
 * BaselineStatusBadge Component
 * 
 * Displays a visual status indicator for span baselines showing their
 * deviation from historical norms using Lucide icons.
 */

import {
    TrendingUp,
    TrendingDown,
    ArrowUp,
    ArrowDown,
    Minus,
    Activity
} from 'lucide-react';

// Status types matching server/monitor/types.ts BaselineStatus
export type BaselineStatus =
    | 'normal'
    | 'above_mean'
    | 'below_mean'
    | 'slope_above'
    | 'slope_below'
    | 'upward_trend'
    | 'downward_trend';

export interface BaselineStatusIndicator {
    status: BaselineStatus;
    deviation: number;
    slopeDeviation?: number;
    trendDirection?: 'up' | 'down' | 'stable';
    confidence: number;
    recentMean?: number;
    previousMean?: number;
}

interface BaselineStatusBadgeProps {
    indicator: BaselineStatusIndicator | undefined;
    showLabel?: boolean;
    size?: 'sm' | 'md' | 'lg';
}

const STATUS_CONFIG: Record<BaselineStatus, {
    icon: typeof TrendingUp;
    label: string;
    color: string;
    bgColor: string;
    description: string;
}> = {
    normal: {
        icon: Minus,
        label: 'Normal',
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-500/10',
        description: 'Performance within expected range',
    },
    above_mean: {
        icon: ArrowUp,
        label: 'Above Mean',
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        description: 'Running slower than historical average (1-3σ)',
    },
    below_mean: {
        icon: ArrowDown,
        label: 'Below Mean',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        description: 'Running faster than historical average (1-3σ)',
    },
    slope_above: {
        icon: TrendingUp,
        label: 'Slope Above',
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
        description: 'Rate of change increasing (1-3σ)',
    },
    slope_below: {
        icon: TrendingDown,
        label: 'Slope Below',
        color: 'text-cyan-500',
        bgColor: 'bg-cyan-500/10',
        description: 'Rate of change decreasing (1-3σ)',
    },
    upward_trend: {
        icon: TrendingUp,
        label: 'Upward Trend',
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/10',
        description: 'Slight increase in latency',
    },
    downward_trend: {
        icon: TrendingDown,
        label: 'Downward Trend',
        color: 'text-teal-500',
        bgColor: 'bg-teal-500/10',
        description: 'Slight decrease in latency',
    },
};

const SIZE_CONFIG = {
    sm: { iconSize: 14, className: 'h-5 w-5 text-xs' },
    md: { iconSize: 16, className: 'h-6 w-6 text-sm' },
    lg: { iconSize: 20, className: 'h-8 w-8 text-base' },
};

export function BaselineStatusBadge({
    indicator,
    showLabel = false,
    size = 'md'
}: BaselineStatusBadgeProps) {
    // Handle missing indicator
    if (!indicator) {
        return (
            <div
                className="inline-flex items-center gap-1 text-gray-400"
                title="No status data available"
            >
                <Activity size={SIZE_CONFIG[size].iconSize} className="opacity-50" />
            </div>
        );
    }

    const config = STATUS_CONFIG[indicator.status] || STATUS_CONFIG.normal;
    const sizeConfig = SIZE_CONFIG[size];
    const Icon = config.icon;

    // Build tooltip with deviation info
    const tooltip = [
        config.description,
        `Deviation: ${indicator.deviation}σ`,
        indicator.confidence < 1
            ? `Confidence: ${Math.round(indicator.confidence * 100)}%`
            : null,
        indicator.recentMean
            ? `Current: ${indicator.recentMean.toFixed(2)}ms`
            : null,
        indicator.previousMean
            ? `Historical: ${indicator.previousMean.toFixed(2)}ms`
            : null,
    ].filter(Boolean).join('\n');

    return (
        <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${config.bgColor}`}
            title={tooltip}
        >
            <Icon size={sizeConfig.iconSize} className={config.color} />
            {showLabel && (
                <span className={`font-medium ${config.color} ${sizeConfig.className}`}>
                    {config.label}
                </span>
            )}
            {indicator.deviation !== 0 && (
                <span className={`text-xs opacity-75 ${config.color}`}>
                    {indicator.deviation > 0 ? '+' : ''}{indicator.deviation.toFixed(1)}σ
                </span>
            )}
        </div>
    );
}

export default BaselineStatusBadge;
