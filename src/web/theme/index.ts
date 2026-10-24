// F.4.99.05 — Тема приложения.src\web\theme\index.ts
// Токены дизайна. Inline-styles пока, без Tailwind.
// В следующих итерациях можно перейти на CSS-переменные + CSS-in-JS.

export const colors = {
  // Базовые
  bg: '#0f172a',
  bgSoft: '#1e293b',
  bgInput: '#0b1220',
  border: '#334155',
  borderSoft: '#1e293b',

  // Текст
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',

  // Акценты
  primary: '#3b82f6',
  primaryHover: '#2563eb',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',

  // Специфичные для домена
  critical: '#b91c1c',
  high: '#ea580c',
  standard: '#3b82f6',
  background: '#64748b',

  // Режимы
  regimeRedCircuit: '#dc2626',
  regimeSteelBell: '#991b1b',
  regimePtt: '#d97706',
  regimeInfoBlockade: '#7c3aed',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 10,
  full: 9999,
} as const;

export const shadow = {
  sm: '0 1px 2px rgba(0,0,0,0.3)',
  md: '0 4px 8px rgba(0,0,0,0.4)',
  lg: '0 8px 20px rgba(0,0,0,0.5)',
} as const;

export const font = {
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace',
} as const;

export const theme = {
  colors,
  spacing,
  fontSize,
  radius,
  shadow,
  font,
} as const;

export type Theme = typeof theme;