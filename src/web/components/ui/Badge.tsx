// |F.4.99.24|Frontend|UI|TypeScript|src/web/components/ui/Badge.tsx
import type { ReactElement } from 'react';

import { colors, fontSize, radius } from '../../theme';

export type BadgeTone =
  | 'default' | 'success' | 'warning' | 'danger' | 'info'
  | 'critical' | 'high' | 'standard' | 'background'
  | 'master';

export interface BadgeProps {
  tone?: BadgeTone;
  children: string;
}

const TONE_BG: Record<BadgeTone, string> = {
  default: 'rgba(148, 163, 184, 0.15)',
  success: 'rgba(16, 185, 129, 0.15)',
  warning: 'rgba(245, 158, 11, 0.15)',
  danger: 'rgba(239, 68, 68, 0.15)',
  info: 'rgba(6, 182, 212, 0.15)',
  critical: 'rgba(185, 28, 28, 0.25)',
  high: 'rgba(234, 88, 12, 0.20)',
  standard: 'rgba(59, 130, 246, 0.20)',
  background: 'rgba(100, 116, 139, 0.20)',
  master: 'rgba(234, 179, 8, 0.20)',
};

const TONE_FG: Record<BadgeTone, string> = {
  default: colors.textMuted,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  critical: colors.critical,
  high: colors.high,
  standard: colors.standard,
  background: colors.background,
  master: '#facc15',
};

export function Badge({ tone = 'default', children }: BadgeProps): ReactElement {
  return (
    <span
      style={{
        background: TONE_BG[tone],
        color: TONE_FG[tone],
        padding: '2px 8px',
        borderRadius: radius.full,
        fontSize: fontSize.xs,
        fontWeight: 500,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}