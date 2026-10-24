// src/web/components/ui/Chart.tsx
/**
 * F.4.99.06 — Chart.
 *
 * Обёртка над recharts + не-recharts примитивы (FlowIndicator, MetricCard,
 * Sparkline, ProgressBar). Все компоненты адаптивны через ResponsiveContainer.
 */

import type { ReactElement } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import { colors, fontSize, radius, spacing } from '../../theme';

// ─── Палитра (циклическая) ───────────────────────────────────────

const PALETTE = [
  colors.primary,
  colors.success,
  colors.warning,
  colors.danger,
  colors.info,
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
];

export function paletteAt(i: number): string {
  return PALETTE[i % PALETTE.length] ?? colors.primary;
}

// ─── Типы ────────────────────────────────────────────────────────

export type ChartType = 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'circular';

export interface ChartSeries {
  key: string;
  label?: string;
  color?: string;
  stackId?: string;
}

export interface ChartConfig {
  xKey?: string;
  series?: ChartSeries[];
  /** Для pie/circular: ключ, содержащий значение */
  valueKey?: string;
  /** Для pie/circular: ключ, содержащий имя сегмента */
  nameKey?: string;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  yUnit?: string;
}

export interface ChartProps {
  type: ChartType;
  data: ReadonlyArray<Record<string, unknown>>;
  config: ChartConfig;
  height?: number;
  responsive?: boolean;
}

// ─── Chart ───────────────────────────────────────────────────────

export function Chart({
  type,
  data,
  config,
  height = 260,
  responsive = true,
}: ChartProps): ReactElement {
  const xKey = config.xKey ?? 'name';
  const series = config.series ?? [];
  const showGrid = config.showGrid ?? true;
  const showLegend = config.showLegend ?? series.length > 1;
  const showTooltip = config.showTooltip ?? true;

  const body = renderBody(type, data, config, series, xKey);

  const wrapped = (
    <>
      {showGrid ? null : null}
      {body}
      {showLegend ? <Legend wrapperStyle={styles.legend} /> : null}
      {showTooltip ? (
        <Tooltip contentStyle={styles.tooltip} labelStyle={styles.tooltipLabel} />
      ) : null}
    </>
  );

  if (!responsive) {
    return <div style={{ width: '100%', height }}>{wrapped}</div>;
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {body as ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function renderBody(
  type: ChartType,
  data: ReadonlyArray<Record<string, unknown>>,
  config: ChartConfig,
  series: ChartSeries[],
  xKey: string,
): ReactElement {
  const grid = config.showGrid ?? true;
  const gridEl = grid ? (
    <CartesianGrid strokeDasharray="3 3" stroke={colors.borderSoft} />
  ) : null;
  const axisProps = {
    stroke: colors.textMuted,
    fontSize: fontSize.xs,
    tickLine: false,
    axisLine: { stroke: colors.borderSoft },
  };

  if (type === 'line') {
    return (
      <LineChart data={data as Record<string, unknown>[]}>
        {gridEl}
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color ?? paletteAt(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    );
  }

  if (type === 'area') {
    return (
      <AreaChart data={data as Record<string, unknown>[]}>
        {gridEl}
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color ?? paletteAt(i)}
            fill={s.color ?? paletteAt(i)}
            fillOpacity={0.25}
            stackId={s.stackId}
          />
        ))}
      </AreaChart>
    );
  }

  if (type === 'bar') {
    return (
      <BarChart data={data as Record<string, unknown>[]}>
        {gridEl}
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={s.color ?? paletteAt(i)}
            stackId={s.stackId}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    );
  }

  if (type === 'pie' || type === 'circular') {
    const valueKey = config.valueKey ?? 'value';
    const nameKey = config.nameKey ?? 'name';
    return (
      <PieChart>
        <Pie
          data={data as Record<string, unknown>[]}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={type === 'circular' ? '60%' : 0}
          outerRadius="80%"
          paddingAngle={type === 'circular' ? 2 : 0}
          stroke={colors.bg}
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={paletteAt(i)} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  if (type === 'radar') {
    return (
      <RadarChart data={data as Record<string, unknown>[]} outerRadius="75%">
        <PolarGrid stroke={colors.borderSoft} />
        <PolarAngleAxis
          dataKey={xKey}
          tick={{ fill: colors.textMuted, fontSize: fontSize.xs }}
        />
        <PolarRadiusAxis
          tick={{ fill: colors.textMuted, fontSize: fontSize.xs }}
        />
        {series.map((s, i) => (
          <Radar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color ?? paletteAt(i)}
            fill={s.color ?? paletteAt(i)}
            fillOpacity={0.4}
          />
        ))}
      </RadarChart>
    );
  }

  return <div />;
}

// ─── FlowIndicator ───────────────────────────────────────────────
// Круговой индикатор баланса. Цвет — по уровню (красный/жёлтый/зелёный).

export interface FlowIndicatorProps {
  balance: number;
  max: number;
  label?: string;
  size?: number;
}

export function FlowIndicator({
  balance,
  max,
  label,
  size = 140,
}: FlowIndicatorProps): ReactElement {
  const pct = max > 0 ? Math.min(1, Math.max(0, balance / max)) : 0;
  const color =
    pct < 0.25 ? colors.danger : pct < 0.6 ? colors.warning : colors.success;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.borderSoft}
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${dash} ${c}`}
            strokeLinecap="round"
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.text,
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 600 }}>
            {Math.round(pct * 100)}%
          </span>
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            {balance} / {max}
          </span>
        </div>
      </div>
      {label ? (
        <div style={{ marginTop: spacing.xs, color: colors.textMuted, fontSize: fontSize.xs }}>
          {label}
        </div>
      ) : null}
    </div>
  );
}

// ─── MetricCard ──────────────────────────────────────────────────
// Число + label + тренд (↑↓ →).

export interface MetricCardProps {
  value: string | number;
  label: string;
  trend?: number;
  trendDirection?: 'up' | 'down' | 'flat';
  hint?: string;
}

export function MetricCard({
  value,
  label,
  trend,
  trendDirection,
  hint,
}: MetricCardProps): ReactElement {
  const dir =
    trendDirection ??
    (trend === undefined
      ? 'flat'
      : trend > 0
        ? 'up'
        : trend < 0
          ? 'down'
          : 'flat');
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  const trendColor =
    dir === 'up' ? colors.success : dir === 'down' ? colors.danger : colors.textMuted;

  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>
        {value}
        {trend !== undefined ? (
          <span style={{ marginLeft: spacing.sm, color: trendColor, fontSize: fontSize.sm }}>
            {arrow} {Math.abs(trend).toFixed(1)}%
          </span>
        ) : null}
      </div>
      {hint ? <div style={styles.metricHint}>{hint}</div> : null}
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────
// Мини-график в строку (для таблиц).

export interface SparklineProps {
  data: ReadonlyArray<{ value: number }>;
  height?: number;
  color?: string;
}

export function Sparkline({
  data,
  height = 32,
  color = colors.primary,
}: SparklineProps): ReactElement {
  if (data.length === 0) {
    return <div style={{ height }} />;
  }
  return (
    <div style={{ width: 120, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data as { value: number }[]}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  height?: number;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
  height = 8,
}: ProgressBarProps): ReactElement {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div style={{ width: '100%' }}>
      {(label || showPercent) ? (
        <div style={styles.progressHeader}>
          {label ? <span style={styles.progressLabel}>{label}</span> : null}
          {showPercent ? (
            <span style={styles.progressLabel}>{Math.round(pct * 100)}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          width: '100%',
          height,
          background: colors.bg,
          borderRadius: height / 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: '100%',
            background: colors.primary,
            transition: 'width 0.2s',
          }}
        />
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  legend: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  tooltip: {
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    fontSize: fontSize.xs,
  },
  tooltipLabel: {
    color: colors.text,
    fontWeight: 600,
  },
  metricCard: {
    padding: spacing.md,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 600,
    display: 'flex' as const,
    alignItems: 'baseline' as const,
  },
  metricHint: {
    color: colors.textDim,
    fontSize: fontSize.xs,
  },
  progressHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
};