// F.4.04.01 — Admin layout.
// Sidebar слева + Outlet справа. Breadcrumbs сверху.
// Разделы: Dashboard, Участники, Мандаты, Recovery, Логи, Система.
//
// TODO: адаптив под узкие экраны — sidebar фиксированный 220px,
//       при необходимости превратить в drawer.

import type { ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { colors, fontSize, radius, spacing } from '../../theme';

// ─────────────────────────────────────────────────────────────────
// Navigation model — единый источник подписей
// ─────────────────────────────────────────────────────────────────

interface Section {
  /** Сегмент URL: ключ для breadcrumbs. */
  segment: string;
  /** Полный путь для NavLink. */
  path: string;
  /** Подпись в sidebar. */
  label: string;
  /** Подпись в breadcrumbs, если отличается от sidebar (например, корень). */
  breadcrumbLabel?: string;
  icon: string;
  end?: boolean;
}

const SECTIONS: readonly Section[] = [
  { segment: 'admin',        path: '/admin',              label: 'Дашборд',   breadcrumbLabel: 'Админ-панель', icon: '📊', end: true },
  { segment: 'requests',     path: '/admin/requests',     label: 'Заявки',    icon: '📥' },
  { segment: 'participants', path: '/admin/participants', label: 'Участники', icon: '👥' },
  { segment: 'mandates',     path: '/admin/mandates',     label: 'Мандаты',   icon: '🎫' },
  { segment: 'recovery',     path: '/admin/recovery',     label: 'Recovery',  icon: '🔑' },
  { segment: 'logs',         path: '/admin/logs',         label: 'Логи',      icon: '📋' },
  { segment: 'webhooks',     path: '/admin/webhooks',     label: 'Webhooks',  icon: '🔔' },
  { segment: 'system',       path: '/admin/system',       label: 'Система',   icon: '⚙️' },
];

/** Карта подписей для breadcrumbs: segment → label. */
const BREADCRUMB_LABEL: Record<string, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.segment, s.breadcrumbLabel ?? s.label]),
);

// ─────────────────────────────────────────────────────────────────
// Breadcrumbs
// ─────────────────────────────────────────────────────────────────

function Breadcrumbs(): ReactElement {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  return (
    <nav style={styles.breadcrumbs} aria-label="Breadcrumbs">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        // Динамические сегменты (UUID и т.п.) пока показываются как есть.
        // Когда появятся карточки сущностей — здесь нужно будет разрешать
        // сегмент в человекочитаемое имя через карту или запрос.
        const label = BREADCRUMB_LABEL[seg] ?? seg;
        return (
          <span key={`${seg}-${i}`} style={styles.crumbWrap}>
            <span style={isLast ? styles.crumbLast : styles.crumb}>{label}</span>
            {!isLast && <span style={styles.crumbSep}>/</span>}
          </span>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────

export function AdminLayout(): ReactElement {
  return (
    <div style={styles.root}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>🛡 Admin</div>
        <nav style={styles.nav}>
          {SECTIONS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              style={({ isActive }) => (isActive ? styles.linkActive : styles.link)}
            >
              <span style={styles.linkIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Контейнер правой колонки. Умышленно <div>, а не <main>:
          внешний Layout уже может предоставлять <main>, второй <main>
          на странице — нарушение доступности. */}
      <div style={styles.content} role="region" aria-label="Admin content">
        <Breadcrumbs />
        <div style={styles.pageBody}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AdminLayout;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

// TODO: перенести в theme.ts как colors.accent / colors.accentSoft,
//       когда появится общий токен акцента (сейчас #60a5fa используется
//       и в табах Admin, и здесь).
const ACCENT = '#60a5fa';
const ACCENT_SOFT = 'rgba(96,165,250,0.12)';

const styles = {
  root: {
    display: 'flex',
    height: '100%',
    background: colors.bg,
  } as const,
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: colors.bgSoft,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  } as const,
  brand: {
    fontSize: fontSize.lg,
    fontWeight: 600,
    padding: `${spacing.sm}px ${spacing.sm}px`,
    color: colors.text,
  } as const,
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  } as const,
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `8px ${spacing.sm}px`,
    borderRadius: radius.sm,
    borderLeft: '2px solid transparent',
    color: colors.textMuted,
    textDecoration: 'none',
    fontSize: fontSize.sm,
  } as const,
  linkActive: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    // Компенсируем 2px слева, чтобы текст не сдвигался относительно неактивных.
    padding: `8px ${spacing.sm}px 8px ${spacing.sm - 2}px`,
    borderRadius: radius.sm,
    borderLeft: `2px solid ${ACCENT}`,
    color: colors.text,
    background: ACCENT_SOFT,
    textDecoration: 'none',
    fontSize: fontSize.sm,
    fontWeight: 500,
  } as const,
  linkIcon: { fontSize: 16, width: 20, display: 'inline-block' } as const,
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  } as const,
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    background: colors.bgSoft,
  } as const,
  crumbWrap: { display: 'inline-flex', alignItems: 'center', gap: 6 } as const,
  crumb: { color: colors.textMuted } as const,
  crumbLast: { color: colors.text, fontWeight: 500 } as const,
  crumbSep: { color: colors.textDim } as const,
  pageBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: spacing.md,
  } as const,
};