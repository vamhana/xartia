// F.4.99.18 — Sidebar
// Меню навигации. Иконки, названия, активный маршрут.

import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

import { useStore, useUser } from '../../store';
import { colors, spacing, fontSize, radius } from '../../theme';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  requiresRole?: readonly string[];
}

const COUNCIL_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER'] as const;
const ARCHITECT_ROLES = ['FIRST_ARCHITECT'] as const;
const NAV_ITEMS: NavItem[] = [
  // ── Личное ──────────────────────────────────────────────
  { path: '/start',              icon: '🚀', label: 'Первый день' },
  { path: '/collective',         icon: '👥', label: 'Коллектив' },
  { path: '/chat',               icon: '💬', label: 'Чат' },
  { path: '/passport',           icon: '👤', label: 'Паспорт' },
  { path: '/workspace',          icon: '🎛️', label: 'Рабочая панель' },

  // ── Ежедневные операции ─────────────────────────────────
  { path: '/tasks',              icon: '📋', label: 'Задачи' },
  { path: '/signals',            icon: '📡', label: 'Сигналы' },
  { path: '/otc',                icon: '✅', label: 'ОТК' },
  { path: '/council/daily-plan', icon: '📅', label: 'Дневной план', requiresRole: COUNCIL_ROLES },
  { path: '/regimes',            icon: '🚦', label: 'Режимы' },

  // ── Ресурсы и потоки ────────────────────────────────────
  { path: '/goods',              icon: '📦', label: 'Блага' },
  { path: '/flows',              icon: '🔄', label: 'Потоки' },
  { path: '/balance',            icon: '⚖️', label: 'Балансировка' },
  { path: '/cells',              icon: '🏢', label: 'Ячейки' },
  { path: '/naryad',             icon: '📋', label: 'Наряд' },
  { path: '/experiments',        icon: '🧪', label: 'Эксперименты' },
  
  // ── Знание и сознание ───────────────────────────────────
  { path: '/psy',                icon: '🧠', label: 'Психоэкология' },
  { path: '/semantic',           icon: '🔮', label: 'Семантика' },
  { path: '/learning',           icon: '🎓', label: 'Обучение' },
  { path: '/verification',       icon: '🔍', label: 'Верификация' },
  { path: '/quanta',             icon: '🔬', label: 'Кванты' },
  { path: '/convergence',        icon: '🔗', label: 'Конвергенция' },

  // ── Право и общество ────────────────────────────────────
  { path: '/jury',               icon: '👨‍⚖️', label: 'Жюри' },
  { path: '/justice',            icon: '🕊️', label: 'Правозащита' },
  { path: '/planetary',          icon: '🌍', label: 'Планета' },

  // ── Система ─────────────────────────────────────────────
  { path: '/archive',            icon: '🗄️', label: 'Архив' },
  { path: '/gateway',            icon: '🚪', label: 'Шлюз' },
  { path: '/automation',         icon: '🤖', label: 'Автоматизация' },
  { path: '/constructor',        icon: '🧩', label: 'Конструктор' },
  { path: '/admin',              icon: '🛡️', label: 'Админ', requiresRole: ARCHITECT_ROLES },
];
export function Sidebar(): ReactElement {
  const open = useStore((s) => s.sidebarOpen);
  const user = useUser();

  if (!open) {return <aside style={{ ...styles.aside, width: 0 }} />;}

  const roles = new Set(user?.roles ?? []);
  const visible = NAV_ITEMS.filter((item) =>
    !item.requiresRole || item.requiresRole.some((r) => roles.has(r)),
  );

  return (
    <aside style={styles.aside}>
      <div style={styles.brand}>XartIA</div>
      <nav style={styles.nav}>
        {visible.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              ...styles.link,
              ...(isActive ? styles.linkActive : {}),
            })}
          >
            <span style={styles.icon}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

const styles = {
  aside: {
    width: 220,
    background: colors.bgSoft,
    borderRight: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'width 0.15s',
    flexShrink: 0,
  },
  brand: {
    padding: `${spacing.md}px ${spacing.md}px`,
    fontSize: fontSize.xl,
    fontWeight: 600,
    color: colors.primary,
    borderBottom: `1px solid ${colors.borderSoft}`,
    letterSpacing: 1,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: spacing.sm,
    gap: 2,
    overflowY: 'auto' as const,
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '8px 12px',
    color: colors.textMuted,
    textDecoration: 'none',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  },
  linkActive: {
    background: colors.bg,
    color: colors.text,
  },
  icon: { fontSize: 16, width: 20, textAlign: 'center' as const },
};