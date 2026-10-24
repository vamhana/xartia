// F.4.04.09 — ParticipantPicker.
// Переиспользуемый поиск участника для форм мандатов (holder / successor).
//
// Логика:
//   - если value не задан → input с debounce 300мс, выпадашка с результатами;
//   - поиск по name / external_id / pseudonym (backend: GET /admin/participants?search=);
//   - если введённое похоже на UUID → точечный GET /admin/participants/:id;
//   - при выборе — onChange(id), показывается карточка с именем;
//   - кнопка «Открыть паспорт» — Link в новой вкладке на /admin/participants?selected=<id>;
//   - кнопка «×» — сброс.
//
// Не путать с URL-сегментом UUID в конце адреса — там он часть deep link.

import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../../theme';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ParticipantBrief {
  id: string;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: string;
}

interface ListEnvelope<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
}

interface ParticipantPickerProps {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL: Record<string, string> = {
  associated:                 'Ассоциированный',
  compatible:                 'Совместимый',
  conditionally_compatible:   'Условно совместимый',
  full:                       'Полный',
  paused:                     'На паузе',
  outside_trust_network:      'Вне сети доверия',
  master:                     'Мастер',
  integrator:                 'Интегратор',
  pioneer:                    'Пионер',
  excluded:                   'Отчуждён',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ParticipantPicker({
  value,
  onChange,
  placeholder = 'Имя, external ID или UUID',
  disabled = false,
}: ParticipantPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  // Debounce — 300мс.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Если value уже задан и открыт — не ищем.
  const searchEnabled = !value && open && debounced.length >= 1;
  const isUuid = UUID_RE.test(debounced);

  // Вариант 1: введён UUID → точечный GET.
  const byIdQ = useApiQuery<ParticipantBrief>(
    ['admin', 'participant-picker', 'by-id', debounced],
    `/admin/participants/${debounced}`,
    { enabled: searchEnabled && isUuid },
  );

  // Вариант 2: текстовый поиск.
  const searchQ = useApiQuery<ListEnvelope<ParticipantBrief>>(
    ['admin', 'participant-picker', 'search', debounced],
    `/admin/participants?search=${encodeURIComponent(debounced)}&per_page=20`,
    { enabled: searchEnabled && !isUuid },
  );

  // Если value задан снаружи (например, из URL), но мы ещё не знаем details —
  // подгружаем карточку, чтобы показать имя.
  const selectedQ = useApiQuery<ParticipantBrief>(
    ['admin', 'participant-picker', 'selected', value],
    `/admin/participants/${value}`,
    { enabled: Boolean(value) },
  );

  const results: ParticipantBrief[] = (() => {
    if (!searchEnabled) {return [];}
    if (isUuid) {
      return byIdQ.data ? [byIdQ.data] : [];
    }
    return searchQ.data?.data ?? [];
  })();

  const loading = searchEnabled && (isUuid ? byIdQ.isLoading : searchQ.isLoading);

  // ─── Render: выбранный участник ──────────────────────────────
  if (value) {
    const selected = selectedQ.data;
    return (
      <div style={styles.selected}>
        {selected ? (
          <>
            <div style={styles.selectedMain}>
              <div style={styles.selectedName}>{selected.name}</div>
              <div style={styles.selectedMeta}>
                <code style={styles.code}>{selected.externalId}</code>
                <Badge tone="info">{statusLabel(selected.status)}</Badge>
              </div>
            </div>
            <Link
              to={`/admin/participants?selected=${selected.id}`}
              target="_blank"
              rel="noreferrer"
              style={styles.openLink}
              title="Открыть паспорт в новой вкладке"
            >
              ↗
            </Link>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setQuery('');
                setDebounced('');
              }}
              disabled={disabled}
              style={styles.clearBtn}
              aria-label="Сбросить"
              title="Сбросить"
            >
              ×
            </button>
          </>
        ) : (
          <div style={styles.selectedLoading}>
            <code style={styles.code}>{value.slice(0, 12)}…</code>
            <span style={styles.muted}> загрузка…</span>
            <button
              type="button"
              onClick={() => onChange('')}
              style={styles.clearBtn}
              aria-label="Сбросить"
            >
              ×
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: поиск ───────────────────────────────────────────
  return (
    <div style={styles.root}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        style={styles.input}
        autoComplete="off"
      />

      {open && debounced.length > 0 && (
        <>
          {/* Затемнение — клик вне закрывает */}
          <div
            style={styles.backdrop}
            onClick={() => setOpen(false)}
          />
          <div style={styles.dropdown}>
            {loading && (
              <div style={styles.dropdownMsg}>Поиск…</div>
            )}
            {!loading && results.length === 0 && (
              <div style={styles.dropdownMsg}>Ничего не найдено</div>
            )}
            {!loading && results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                style={styles.option}
              >
                <div style={styles.optionMain}>
                  <div style={styles.optionName}>{p.name}</div>
                  <div style={styles.optionMeta}>
                    <code style={styles.code}>{p.externalId}</code>
                    <span style={styles.optionStatus}>{statusLabel(p.status)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ParticipantPicker;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  root: { position: 'relative' } as const,
  input: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    width: '100%',
    boxSizing: 'border-box',
  } as const,

  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10,
  } as const,
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    maxHeight: 280,
    overflowY: 'auto',
    zIndex: 11,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  } as const,
  dropdownMsg: {
    padding: spacing.sm,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  } as const,

  option: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer',
    color: colors.text,
    font: 'inherit',
  } as const,
  optionMain: { display: 'flex', flexDirection: 'column', gap: 2 } as const,
  optionName: { fontSize: fontSize.sm, fontWeight: 500 } as const,
  optionMeta: { display: 'flex', gap: spacing.sm, alignItems: 'center' } as const,
  optionStatus: { fontSize: fontSize.xs, color: colors.textMuted } as const,

  selected: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.borderSoft}`,
    background: colors.bgSoft,
  } as const,
  selectedMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } as const,
  selectedName: { fontSize: fontSize.sm, fontWeight: 500, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
  selectedMeta: { display: 'flex', gap: spacing.sm, alignItems: 'center' } as const,
  selectedLoading: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 } as const,

  openLink: {
    color: colors.primary,
    textDecoration: 'none',
    fontSize: fontSize.md,
    padding: '0 4px',
  } as const,
  clearBtn: {
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    fontSize: fontSize.md,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  } as const,

  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.textMuted } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
};