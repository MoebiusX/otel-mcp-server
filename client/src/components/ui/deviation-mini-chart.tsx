/**
 * DeviationMiniChart Component
 * 
 * A compact SVG visualization showing how the current value deviates from the historical mean.
 * - Green horizontal line: Historical mean
 * - Yellow/green rectangle: Standard deviation band (±1σ = normal)
 * - Data point: Color matches the status badge for consistency
 */

import type { BaselineStatus } from './baseline-status-badge';

interface DeviationMiniChartProps {
    /** Current value (e.g., current hour's mean) */
    currentValue: number;
    /** Historical mean value */
    mean: number;
    /** Standard deviation */
    stdDev: number;
    /** Number of σ from mean (pre-calculated deviation) */
    deviation?: number;
    /** Status from the badge - used to determine point color */
    status?: BaselineStatus;
    /** Chart width in pixels */
    width?: number;
    /** Chart height in pixels */
    height?: number;
}

// Color mapping that matches BaselineStatusBadge
const STATUS_COLORS: Record<BaselineStatus, { fill: string; glow: string }> = {
    normal: { fill: '#10b981', glow: 'drop-shadow(0 0 3px #10b98180)' },
    above_mean: { fill: '#f59e0b', glow: 'drop-shadow(0 0 4px #f59e0b80)' },
    below_mean: { fill: '#3b82f6', glow: 'drop-shadow(0 0 4px #3b82f680)' },
    slope_above: { fill: '#f97316', glow: 'drop-shadow(0 0 4px #f9731680)' },
    slope_below: { fill: '#06b6d4', glow: 'drop-shadow(0 0 4px #06b6d480)' },
    upward_trend: { fill: '#eab308', glow: 'drop-shadow(0 0 3px #eab30880)' },
    downward_trend: { fill: '#14b8a6', glow: 'drop-shadow(0 0 3px #14b8a680)' },
};

export function DeviationMiniChart({
    currentValue,
    mean,
    stdDev,
    deviation,
    status = 'normal',
    width = 100,
    height = 36,
}: DeviationMiniChartProps) {
    // Calculate deviation if not provided
    const sigma = deviation ?? (stdDev > 0 ? (currentValue - mean) / stdDev : 0);

    // Clamp display range to ±4σ for visual clarity
    const maxSigma = 4;
    const clampedSigma = Math.max(-maxSigma, Math.min(maxSigma, sigma));

    // Calculate positions
    const padding = 8;
    const chartWidth = width - padding * 2;
    const chartHeight = height - 4;
    const centerY = height / 2;
    const centerX = width / 2;

    // Map sigma to x position (center = mean, edges = ±4σ)
    const sigmaToX = (s: number) => centerX + (s / maxSigma) * (chartWidth / 2);

    // Standard deviation band boundaries (±1σ and ±2σ)
    const band1Left = sigmaToX(-1);
    const band1Right = sigmaToX(1);
    const band2Left = sigmaToX(-2);
    const band2Right = sigmaToX(2);
    const bandWidth1 = band1Right - band1Left;
    const bandWidth2 = band2Right - band2Left;

    // Data point position
    const pointX = sigmaToX(clampedSigma);

    // Use status-based coloring for consistency with badge
    const colorConfig = STATUS_COLORS[status] || STATUS_COLORS.normal;

    return (
        <svg
            width={width}
            height={height}
            className="inline-block"
            style={{ verticalAlign: 'middle' }}
        >
            {/* Background */}
            <rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill="transparent"
            />

            {/* ±2σ band (outer, lighter) */}
            <rect
                x={band2Left}
                y={centerY - chartHeight * 0.4}
                width={bandWidth2}
                height={chartHeight * 0.8}
                fill="#facc15"
                opacity={0.15}
                rx={2}
            />

            {/* ±1σ band (inner, normal range) */}
            <rect
                x={band1Left}
                y={centerY - chartHeight * 0.35}
                width={bandWidth1}
                height={chartHeight * 0.7}
                fill="#22c55e"
                opacity={0.25}
                rx={2}
            />

            {/* Mean line (center) */}
            <line
                x1={padding}
                y1={centerY}
                x2={width - padding}
                y2={centerY}
                stroke="#22c55e"
                strokeWidth={1.5}
                strokeDasharray="2,2"
                opacity={0.7}
            />

            {/* Data point - color matches status badge */}
            <circle
                cx={pointX}
                cy={centerY}
                r={6}
                fill={colorConfig.fill}
                style={{ filter: colorConfig.glow }}
            />

            {/* Inner highlight on point */}
            <circle
                cx={pointX - 1.5}
                cy={centerY - 1.5}
                r={2}
                fill="white"
                opacity={0.4}
            />
        </svg>
    );
}

export default DeviationMiniChart;
