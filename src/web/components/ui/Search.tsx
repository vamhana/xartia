// src/web/components/ui/Search.tsx
/**
 * F.4.99.16 — Универсальный поиск.
 *
 * 4 экспорта:
 *   - `Search`         — компактный триггер в Header (открывает палитру).
 *   - `CommandPalette` — модальное окно с поиском (Cmd+K / Ctrl+K).
 *   - `useSearch`      — хук с debounce 300мс + React Query.
 *   - `useSearchShortcut` — глобальный listener Cmd+K → paletteStore.toggle().
 *
 * Без cmdk — свой код. История запросов в localStorage (xartia.search.history).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiGet } from '../../api/client';
import { colors, fontSize, radius, shadow, spacing } from '../../theme';
import type { SearchResult, SearchType } from '../../types';

// ─── Типы ────────────────────────────────────────────────────────

export interface SearchProps {
  types?: SearchType[];
  placeholder?: string;
  onSelect?: (result: SearchResult) => void;
  /**
   * Если true — Search сам вешает listener на Cmd+K (для изолированного
   * использования без Layout). Если ещё и Layout вызывает useSearchShortcut,
   * двойной listener безопасен — paletteStore.open() идемпотентен.
   */
  openOnShortcut?: boolean;
}

export interface UseSearchResult {
  results: SearchResult[];
  loading: boolean;
  error: Error | null;
}

// ─── Палитра: глобальный синглтон ───────────────────────────────

type PaletteListener = (open: boolean) => void;

let paletteOpen = false;
const paletteListeners = new Set<PaletteListener>();

let paletteOptions: {
  types?: SearchType[];
  onSelect?: (r: SearchResult) => void;
} = {};

export const paletteStore = {
  isOpen: (): boolean => paletteOpen,

  open(): void {
    if (paletteOpen) {return;}
    paletteOpen = true;
    for (const l of paletteListeners) {l(true);}
  },

  close(): void {
    if (!paletteOpen) {return;}
    paletteOpen = false;
    for (const l of paletteListeners) {l(false);}
  },

  toggle(): void {
    if (paletteOpen) {
      paletteStore.close();
    } else {
      paletteStore.open();
    }
  },

  subscribe(l: PaletteListener): () => void {
    paletteListeners.add(l);
    return () => {
      paletteListeners.delete(l);
    };
  },

  setOptions(opts: {
    types?: SearchType[];
    onSelect?: (r: SearchResult) => void;
  }): void {
    paletteOptions = opts;
  },

  getOptions(): {
    types?: SearchType[];
    onSelect?: (r: SearchResult) => void;
  } {
    return paletteOptions;
  },
};

// ─── useSearch ───────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

export function useSearch(
  query: string,
  types?: SearchType[],
): UseSearchResult {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  const enabled = debounced.length >= MIN_QUERY_LEN;
  const typesParam = types && types.length > 0 ? types.join(',') : undefined;

  const q = useQuery<{ results: SearchResult[]; total: number }>({
    queryKey: ['search', debounced, typesParam ?? ''],
    queryFn: () =>
      apiGet<{ results: SearchResult[]; total: number }>('/search', {
        q: debounced,
        ...(typesParam ? { types: typesParam } : {}),
        per_page: 20,
      }),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  return {
    results: q.data?.results ?? [],
    loading: q.isLoading,
    error: (q.error as Error | null) ?? null,
  };
}

// ─── useSearchShortcut ──────────────────────────────────────────

export function useSearchShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        paletteStore.toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

// ─── Search (триггер в Header) ──────────────────────────────────

export function Search({
  types,
  placeholder = 'Поиск…',
  onSelect,
  openOnShortcut = false,
}: SearchProps): ReactElement {
  // Регистрируем опции в палитре, чтобы CommandPalette знал про onSelect/types.
  useEffect(() => {
    paletteStore.setOptions({
      ...(types ? { types } : {}),
      ...(onSelect ? { onSelect } : {}),
    });
  }, [types, onSelect]);

  // Дополнительный listener (если Search используется без useSearchShortcut).
  useEffect(() => {
    if (!openOnShortcut) {return;}
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        paletteStore.open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openOnShortcut]);

  return (
    <button
      type="button"
      onClick={() => paletteStore.open()}
      style={styles.trigger}
      aria-label="Открыть поиск"
      title="Поиск (Ctrl+K)"
    >
      <span style={styles.triggerIcon}>🔍</span>
      <span style={styles.triggerText}>{placeholder}</span>
      <kbd style={styles.triggerKbd}>⌘K</kbd>
    </button>
  );
}

// ─── CommandPalette ─────────────────────────────────────────────

const TYPE_LABEL: Record<SearchType, string> = {
  participant: 'Участники',
  signal: 'Сигналы',
  good: 'Блага',
  archive: 'Архив',
  task: 'Задачи',
};

const HISTORY_KEY = 'xartia.search.history';
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) {return [];}
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {return [];}
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  } catch {
    // ignore quota
  }
}

export function CommandPalette(): ReactElement | null {
  const navigate = useNavigate();
  const [open, setOpen] = useState(paletteStore.isOpen());
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Подписка на paletteStore.
  useEffect(() => {
    const unsub = paletteStore.subscribe((isOpen) => {
      setOpen(isOpen);
      if (isOpen) {
        setQuery('');
        setSelectedIndex(0);
        // фокус — после рендера
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    });
    return unsub;
  }, []);

  const options = paletteStore.getOptions();
  const { results, loading } = useSearch(query, options.types);

  // Сбрасываем выбранный индекс при смене результатов.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Скролл к выбранному.
  useEffect(() => {
    if (!listRef.current) {return;}
    const el = listRef.current.querySelector(
      `[data-search-idx="${selectedIndex}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Группировка результатов с сохранением flat-индекса.
  const groups = useMemo(() => {
    const map = new Map<SearchType, Array<{ result: SearchResult; flatIdx: number }>>();
    results.forEach((r, i) => {
      const arr = map.get(r.type) ?? [];
      arr.push({ result: r, flatIdx: i });
      map.set(r.type, arr);
    });
    return map;
  }, [results]);

  const select = (r: SearchResult): void => {
    // Сохраняем в историю (по query, не по результату).
    if (query.trim().length > 0) {
      const next = [query.trim(), ...history.filter((h) => h !== query.trim())].slice(0, HISTORY_MAX);
      setHistory(next);
      saveHistory(next);
    }

    paletteStore.close();

    if (options.onSelect) {
      options.onSelect(r);
    } else {
      navigate(r.url);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      paletteStore.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[selectedIndex];
      if (picked) {select(picked);}
    }
  };

  if (!open) {return null;}

  return (
    <div style={styles.backdrop} onClick={() => paletteStore.close()}>
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.searchRow}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск по всем сущностям…"
            style={styles.searchInput}
            autoComplete="off"
          />
          <kbd style={styles.escKbd}>Esc</kbd>
        </div>

        <div ref={listRef} style={styles.results}>
          {query.trim().length < MIN_QUERY_LEN ? (
            history.length > 0 ? (
              <div style={styles.group}>
                <div style={styles.groupLabel}>Недавние запросы</div>
                {history.map((h) => (
                  <button
                    key={h}
                    type="button"
                    style={styles.historyItem}
                    onClick={() => setQuery(h)}
                  >
                    ↺ {h}
                  </button>
                ))}
              </div>
            ) : (
              <div style={styles.empty}>
                Начните вводить запрос (минимум 2 символа)
              </div>
            )
          ) : loading ? (
            <div style={styles.empty}>Поиск…</div>
          ) : results.length === 0 ? (
            <div style={styles.empty}>Ничего не найдено</div>
          ) : (
            Array.from(groups.entries()).map(([type, list]) => (
              <div key={type} style={styles.group}>
                <div style={styles.groupLabel}>{TYPE_LABEL[type]}</div>
                {list.map(({ result, flatIdx }) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    data-search-idx={flatIdx}
                    onClick={() => select(result)}
                    onMouseEnter={() => setSelectedIndex(flatIdx)}
                    style={{
                      ...styles.resultItem,
                      ...(flatIdx === selectedIndex ? styles.resultItemSelected : {}),
                    }}
                  >
                    <div style={styles.resultTitle}>{result.title}</div>
                    <div
                      style={styles.resultSnippet}
                      // snippet приходит уже с экранированным HTML + <mark>
                      dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div style={styles.footer}>
          <span style={styles.footerHint}>
            <kbd style={styles.footerKbd}>↑</kbd>
            <kbd style={styles.footerKbd}>↓</kbd> навигация ·
            <kbd style={styles.footerKbd}>Enter</kbd> открыть ·
            <kbd style={styles.footerKbd}>Esc</kbd> закрыть
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  // ─── Триггер ───
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgInput,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 220,
  } as const,
  triggerIcon: { fontSize: 14 } as const,
  triggerText: { flex: 1, textAlign: 'left' as const } as const,
  triggerKbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 10,
    padding: '2px 5px',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 4,
    color: colors.textDim,
  } as const,

  // ─── Модалка ───
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'center' as const,
    zIndex: 200,
    paddingTop: '10vh',
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
  } as const,
  modal: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '70vh',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    overflow: 'hidden' as const,
  } as const,

  searchRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    padding: `${spacing.md}px ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  searchIcon: { fontSize: 18, color: colors.textMuted } as const,
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: colors.text,
    fontSize: fontSize.md,
    fontFamily: 'inherit',
  } as const,
  escKbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 10,
    padding: '2px 6px',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 4,
    color: colors.textDim,
  } as const,

  results: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: `${spacing.sm}px 0`,
  } as const,
  group: {
    padding: `0 ${spacing.sm}px`,
    marginBottom: spacing.sm,
  } as const,
  groupLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    padding: `${spacing.xs}px ${spacing.sm}px`,
  } as const,

  resultItem: {
    display: 'block' as const,
    width: '100%',
    textAlign: 'left' as const,
    padding: `${spacing.sm}px ${spacing.md}px`,
    background: 'transparent',
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer' as const,
    color: colors.text,
    fontFamily: 'inherit' as const,
  } as const,
  resultItemSelected: {
    background: 'rgba(59, 130, 246, 0.15)',
  } as const,
  resultTitle: {
    fontSize: fontSize.sm,
    fontWeight: 500,
    marginBottom: 2,
  } as const,
  resultSnippet: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 1.4,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    display: '-webkit-box' as const,
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  } as const,

  historyItem: {
    display: 'block' as const,
    width: '100%',
    textAlign: 'left' as const,
    padding: `${spacing.sm}px ${spacing.md}px`,
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    fontFamily: 'inherit' as const,
    borderRadius: radius.sm,
  } as const,

  empty: {
    padding: spacing.lg,
    textAlign: 'center' as const,
    color: colors.textMuted,
    fontSize: fontSize.sm,
  } as const,

  footer: {
    padding: `${spacing.xs}px ${spacing.lg}px`,
    borderTop: `1px solid ${colors.borderSoft}`,
    background: colors.bg,
  } as const,
  footerHint: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 4,
    flexWrap: 'wrap' as const,
  } as const,
  footerKbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 10,
    padding: '1px 5px',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 4,
    color: colors.textDim,
  } as const,
};