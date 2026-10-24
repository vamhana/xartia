// |F.4.99.26|Frontend|UI|TypeScript|src/web/components/ui/Spinner.tsx
import type { ReactElement } from 'react';

import { colors, fontSize } from '../../theme';

export function Spinner({ label = 'Загрузка…' }: { label?: string }): ReactElement {
  return (
    <div style={styles.wrap}>
      <div style={styles.dot} />
      <span style={styles.label}>{label}</span>
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    padding: 20,
  } as const,
  dot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: `2px solid ${colors.border}`,
    borderTopColor: colors.primary,
    animation: 'xartia-spin 0.8s linear infinite',
  } as const,
  label: {} as const,
};

// Инжектим keyframes один раз.
if (typeof document !== 'undefined' && !document.getElementById('xartia-spin-style')) {
  const style = document.createElement('style');
  style.id = 'xartia-spin-style';
  style.textContent = '@keyframes xartia-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}