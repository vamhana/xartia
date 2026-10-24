// |F.4.99.03|Frontend|UI|React|src/web/components/ui/Card.tsx|
import type { ReactElement, ReactNode } from 'react';

import { colors, spacing, fontSize, radius, shadow } from '../../theme';

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padding?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outlined';
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  padding = 'md',
  variant = 'default',
}: CardProps): ReactElement {
  const pad = spacing[padding];

  return (
    <div style={{ ...styles.card, ...(variant === 'outlined' ? styles.outlined : {}) }}>
      {(title || actions) && (
        <div style={{ ...styles.header, padding: `${pad}px ${pad}px 0 ${pad}px` }}>
          <div style={styles.headerLeft}>
            {title && <div style={styles.title}>{title}</div>}
            {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
          </div>
          {actions && <div style={styles.actions}>{actions}</div>}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

const styles = {
  card: {
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    boxShadow: shadow.sm,
    marginBottom: spacing.md,
  } as const,
  outlined: {
    border: `1px solid ${colors.border}`,
  } as const,
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  } as const,
  headerLeft: { minWidth: 0 } as const,
  title: {
    fontSize: fontSize.lg,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 2,
  } as const,
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  } as const,
  actions: { display: 'flex', gap: spacing.sm, flexShrink: 0 } as const,
};