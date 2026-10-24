// |F.4.99.25|Frontend|UI|TypeScript|src/web/components/ui/Button.tsx
import type { ReactElement, ButtonHTMLAttributes } from 'react';

import { colors, spacing, fontSize, radius } from '../../theme';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonProps): ReactElement {
  const base = {
    border: 'none',
    borderRadius: radius.md,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'background 0.15s',
  } as const;

  const sizeStyle = size === 'sm'
    ? { padding: '4px 10px', fontSize: fontSize.xs }
    : { padding: '8px 16px', fontSize: fontSize.sm };

  const variantStyle = {
    primary: { background: colors.primary, color: '#fff' },
    secondary: {
      background: 'transparent',
      color: colors.text,
      border: `1px solid ${colors.border}`,
    },
    ghost: { background: 'transparent', color: colors.textMuted },
    danger: { background: colors.danger, color: '#fff' },
  }[variant];

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{ ...base, ...sizeStyle, ...variantStyle, ...rest.style }}
    >
      {loading ? '…' : children}
    </button>
  );
}

export const buttonGap = spacing.sm;