// src/web/components/ui/Table.tsx
/**
 * F.4.99.02 — Table.
 *
 * Универсальная таблица: сортировка, фильтр, пагинация, выбор строк.
 * Без @tanstack/react-table — на чистом React.
 */

import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { colors, fontSize, radius, spacing } from '../../theme';

// ─── Типы ────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  sortable?: boolean;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
}

export interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
}

export interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  getRowId?: (row: T) => string;
  pagination?: PaginationProps;
  emptyMessage?: string;
}

// ─── Хуки ────────────────────────────────────────────────────────

export function useTableSort(
  initialKey?: string,
): {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  toggleSort: (key: string) => void;
} {
  const [sortKey, setSortKey] = useState<string | null>(initialKey ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string): void => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return { sortKey, sortDir, toggleSort };
}

export function useTableFilter<T>(
  data: T[],
  filterFn: (row: T, query: string) => boolean,
): { filtered: T[]; filter: string; setFilter: (s: string) => void } {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(
    () => (filter ? data.filter((r) => filterFn(r, filter)) : data),
    [data, filter, filterFn],
  );
  return { filtered, filter, setFilter };
}

// ─── Вспомогательные ─────────────────────────────────────────────

function toWidth(w: string | number | undefined): string | undefined {
  if (w === undefined) {return undefined;}
  return typeof w === 'number' ? `${w}px` : w;
}

function defaultGetValue<T>(row: T, key: string): string | number | null {
  const v = (row as Record<string, unknown>)[key];
  if (v === null || v === undefined) {return null;}
  if (typeof v === 'string' || typeof v === 'number') {return v;}
  return String(v);
}

// ─── TableSkeleton ───────────────────────────────────────────────

export function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}): ReactElement {
  return (
    <div style={styles.skeletonWrap}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={styles.skeletonRow}>
          {Array.from({ length: columns }).map((__, j) => (
            <div key={j} style={styles.skeletonCell} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Table ───────────────────────────────────────────────────────

export function Table<T>({
  data,
  columns,
  loading = false,
  onRowClick,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  getRowId,
  pagination,
  emptyMessage = 'Нет данных',
}: TableProps<T>): ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const visibleColumns = useMemo(
    () => columns.filter((c) => !c.hidden),
    [columns],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const sorted = useMemo(() => {
    if (!sortKey) {return data;}
    const col = visibleColumns.find((c) => c.key === sortKey);
    if (!col) {return data;}
    const get = col.sortValue ?? ((r: T) => defaultGetValue(r, col.key));
    const arr = [...data];
    arr.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === null && bv === null) {return 0;}
      if (av === null) {return 1;}
      if (bv === null) {return -1;}
      if (av < bv) {return sortDir === 'asc' ? -1 : 1;}
      if (av > bv) {return sortDir === 'asc' ? 1 : -1;}
      return 0;
    });
    return arr;
  }, [data, visibleColumns, sortKey, sortDir]);

  const toggleSort = (key: string): void => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const rowId = (row: T, i: number): string =>
    getRowId ? getRowId(row) : String(i);

  const allSelected =
    selectable &&
    sorted.length > 0 &&
    sorted.every((row, i) => selectedSet.has(rowId(row, i)));

  const toggleAll = (): void => {
    if (!onSelectionChange) {return;}
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(sorted.map((row, i) => rowId(row, i)));
    }
  };

  const toggleRow = (row: T, i: number): void => {
    if (!onSelectionChange) {return;}
    const id = rowId(row, i);
    if (selectedSet.has(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  if (loading) {
    return <TableSkeleton rows={5} columns={visibleColumns.length || 4} />;
  }

  if (sorted.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {selectable ? (
              <th style={{ ...styles.th, width: 40 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Выбрать все"
                />
              </th>
            ) : null}
            {visibleColumns.map((col) => {
              const isSorted = sortKey === col.key;
              const arrow = isSorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
              const clickable = col.sortable === true;
              return (
                <th
                  key={col.key}
                  style={{
                    ...styles.th,
                    textAlign: col.align ?? 'left',
                    width: toWidth(col.width),
                    cursor: clickable ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                  onClick={clickable ? () => toggleSort(col.key) : undefined}
                >
                  {col.title}
                  {arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const id = rowId(row, i);
            const selected = selectedSet.has(id);
            return (
              <tr
                key={id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  ...styles.tr,
                  ...(selected ? styles.trSelected : {}),
                  cursor: onRowClick ? 'pointer' : 'default',
                }}
              >
                {selectable ? (
                  <td style={{ ...styles.td, width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRow(row, i)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Выбрать строку"
                    />
                  </td>
                ) : null}
                {visibleColumns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      ...styles.td,
                      textAlign: col.align ?? 'left',
                    }}
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[col.key] ?? '',
                        )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {pagination && pagination.total > 0 ? (
        <div style={styles.pagination}>
          <span style={styles.pageInfo}>
            Всего: {pagination.total}
          </span>
          <div style={styles.pageControls}>
            <button
              type="button"
              style={styles.pageBtn}
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              ←
            </button>
            <span style={styles.pageInfo}>
              {pagination.page} /{' '}
              {Math.max(1, Math.ceil(pagination.total / pagination.perPage))}
            </span>
            <button
              type="button"
              style={styles.pageBtn}
              disabled={
                pagination.page * pagination.perPage >= pagination.total
              }
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              →
            </button>
            {pagination.onPerPageChange ? (
              <select
                value={pagination.perPage}
                onChange={(e) =>
                  pagination.onPerPageChange?.(Number(e.target.value))
                }
                style={styles.pageSelect}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / стр.
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  wrap: {
    width: '100%',
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: fontSize.sm,
  },
  th: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    textAlign: 'left' as const,
    fontWeight: 600,
    color: colors.textMuted,
    background: colors.bg,
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    whiteSpace: 'nowrap' as const,
  },
  tr: {
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  trSelected: {
    background: 'rgba(96,165,250,0.08)',
  },
  td: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    color: colors.text,
    verticalAlign: 'middle' as const,
  },
  empty: {
    padding: spacing.xl,
    textAlign: 'center' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  pagination: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: `${spacing.sm}px ${spacing.md}px`,
    background: colors.bg,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  pageControls: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  pageInfo: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  pageBtn: {
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: fontSize.sm,
  },
  pageSelect: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '4px 8px',
    fontSize: fontSize.xs,
  },
  skeletonWrap: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 8,
    padding: spacing.md,
  },
  skeletonRow: {
    display: 'flex' as const,
    gap: 8,
  },
  skeletonCell: {
    flex: 1,
    height: 20,
    background: colors.bg,
    borderRadius: radius.sm,
    opacity: 0.5,
  },
};