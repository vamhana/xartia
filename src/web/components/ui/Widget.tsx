// F.4.99.01 — Widget registry.src\web\components\ui\Widget.tsx
/**
 * Рендер виджета по типу. Обёртка с error boundary.
 * Реестр расширяется — новые типы добавляются в WIDGET_REGISTRY.
 */

import { Component, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from 'react';


import { colors, fontSize, radius, spacing } from '../../theme';

import { Badge } from './Badge';
import { Chart, FlowIndicator, MetricCard, ProgressBar } from './Chart';
import { Map as LeafletMap } from './Map';
import { Table } from './Table';
import type { Column } from './Table';

// ─── Типы ────────────────────────────────────────────────────────

export interface WidgetInstanceRef {
  id: string;
  panelId: string;
  widgetId: string;
  position: Record<string, unknown>;
  size: Record<string, unknown>;
  overrides: Record<string, unknown>;
  createdAt: string;
}

export interface WidgetLibraryEntry {
  id: string;
  type: string;
  entity: string;
  config: Record<string, unknown>;
  defaultRights: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export type WidgetContext = 'normal' | 'crisis' | 'steel_bell';

export interface WidgetProps {
  instance: WidgetInstanceRef;
  widget: WidgetLibraryEntry;
  context: WidgetContext;
  /** Опциональный набор данных — если родитель уже загрузил и хочет передать */
  data?: unknown;
  onAction?: (action: string, params: unknown) => void;
}

// ─── Helper'ы ────────────────────────────────────────────────────

function readString(
  obj: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = obj[key];
  return typeof v === 'string' ? v : fallback;
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = obj[key];
  return typeof v === 'number' ? v : fallback;
}

function mergedConfig(
  widget: WidgetLibraryEntry,
  instance: WidgetInstanceRef,
): Record<string, unknown> {
  return { ...widget.config, ...instance.overrides };
}


/** Куда ведёт виджет: клик по шапке открывает полный раздел. */
export const ENTITY_ROUTE: Record<string, string> = {
  tasks: '/tasks',
  my_tasks: '/tasks',
  signals: '/signals',
  cells: '/cells',
  cell: '/cells',
  cell_tree: '/cells',
  plans: '/balance',
  daily_plan: '/naryad',
  archive: '/archive',
  communities: '/planetary',
  goods: '/goods',
  flows: '/flows',
  regimes: '/regimes',
  transactions: '/gateway',
  assets: '/gateway',
  gateway_council: '/gateway',
  otc_queue: '/otc',
  otc_stats: '/otc',
  mandates: '/admin/mandates',
  participants: '/admin/participants',
  courses: '/learning',
  audits: '/verification',
  rechecks: '/verification',
  complaints: '/justice',
  investigations: '/justice',
  arbitrations: '/justice',
  jury_session: '/jury',
  jury_votes: '/jury',
  oversight: '/balance',
  council: '/councils',
  signatories: '/treasury',
  spend_requests: '/treasury',
  treasury_price: '/treasury',
  treasury_coverage: '/treasury',
  mentees: '/admin/mentors',
  dictionary: '/semantic',
  connections: '/collective',
  all_connections: '/collective',
  notifications_history: '/workspace',
};

export function entityRoute(entity: string | undefined): string | null {
  if (!entity) {return null;}
  return ENTITY_ROUTE[entity] ?? null;
}

// ─── Базовые рендеры (по типам) ─────────────────────────────────

interface ItemShape {
  id?: string;
  title?: string;
  name?: string;
  label?: string;
  value?: number | string;
  status?: string;
  [key: string]: unknown;
}

function renderList(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const items = Array.isArray(props.data) ? (props.data as ItemShape[]) : [];
  const titleKey = readString(cfg, 'titleKey', 'title');
  const emptyText = readString(cfg, 'emptyText', 'Нет данных');

  if (items.length === 0) {
    return <EmptyBlock message={emptyText} />;
  }

  return (
    <div style={styles.list}>
      {items.map((item, i) => {
        const title =
          (item[titleKey] as string | undefined) ??
          item.title ??
          item.name ??
          item.label ??
          `Элемент ${i + 1}`;
        const value = item.value;
        const href = entityRoute(props.widget.entity);
        const row = (
          <>
            <span style={styles.listTitle}>{title}</span>
            {value !== undefined ? (
              <span style={styles.listValue}>{String(value)}</span>
            ) : null}
          </>
        );
        return href ? (
          <a
            key={item.id ?? i}
            href={href}
            style={{ ...styles.listRow, textDecoration: 'none' }}
          >
            {row}
          </a>
        ) : (
          <div key={item.id ?? i} style={styles.listRow}>{row}</div>
        );
      })}
    </div>
  );
}

/**
 * Ключ, под которым во временную копию строки кладётся детерминированный
 * идентификатор. Не должен попадать в реальные данные — фильтруется
 * при автоматическом построении колонок.
 */
const ROW_KEY = '__rowKey' as const;

function renderTable(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const rawItems = Array.isArray(props.data) ? (props.data as ItemShape[]) : [];

  // Формируем стабильный ключ заранее, из данных и индекса.
  // Math.random() здесь недопустим: он давал новый id на каждом рендере,
  // что ломало reconciliation в Table (потеря фокуса, выделения, скролла).
  const items: ItemShape[] = rawItems.map((it, i) => ({
    ...it,
    [ROW_KEY]:
      it.id ??
      (it['key'] as string | undefined) ??
      (it['name'] as string | undefined) ??
      `row-${i}`,
  }));

  if (items.length === 0) {
    return <EmptyBlock message="Нет данных" />;
  }

  const columnsCfg = Array.isArray(cfg['columns'])
    ? (cfg['columns'] as Array<{ key: string; title: string }>)
    : null;

  const sample = items[0];
  const columns: Column<ItemShape>[] = columnsCfg
    ? columnsCfg.map((c) => ({
        key: c.key,
        title: c.title,
        render: (r) => String(r[c.key] ?? '—'),
      }))
    : sample
      ? Object.keys(sample)
          .filter((k) => k !== ROW_KEY)
          .slice(0, 6)
          .map((k) => ({
            key: k,
            title: k,
            render: (r) => String(r[k] ?? '—'),
          }))
      : [];

  return (
    <Table<ItemShape>
        onRowClick={() => {
          const href = entityRoute(props.widget.entity);
          if (href) {window.location.assign(href);}
        }}
      data={items}
      columns={columns}
      getRowId={(r) => String(r[ROW_KEY])}
    />
  );
}

function renderCard(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const data =
    props.data && typeof props.data === 'object'
      ? (props.data as Record<string, unknown>)
      : {};
  const fields = Array.isArray(cfg['fields'])
    ? (cfg['fields'] as Array<{ key: string; label: string }>)
    : Object.keys(data).slice(0, 8).map((k) => ({ key: k, label: k }));

  return (
    <div style={styles.cardGrid}>
      {fields.map((f) => (
        <div key={f.key} style={styles.cardField}>
          <span style={styles.cardLabel}>{f.label}</span>
          <span style={styles.cardValue}>
            {data[f.key] !== undefined ? String(data[f.key]) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function renderMetric(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const label = readString(cfg, 'label', props.widget.entity);
  const value =
    typeof props.data === 'object' && props.data !== null && 'value' in props.data
      ? (props.data as { value: number | string }).value
      : (cfg['value'] as number | string | undefined) ?? 0;
  const trendRaw = cfg['trend'];
  const trend = typeof trendRaw === 'number' ? trendRaw : undefined;
  const hint = typeof cfg['hint'] === 'string' ? cfg['hint'] : undefined;

  return (
    <MetricCard
      value={value}
      label={label}
      {...(trend !== undefined ? { trend } : {})}
      {...(hint !== undefined ? { hint } : {})}
    />
  );
}

function renderProgress(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const label = readString(cfg, 'label', '');
  const max = readNumber(cfg, 'max', 100);
  const value =
    typeof props.data === 'object' && props.data !== null && 'value' in props.data
      ? Number((props.data as { value: unknown }).value)
      : readNumber(cfg, 'value', 0);

  return <ProgressBar value={value} max={max} label={label || undefined} />;
}

function renderCircular(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const label = readString(cfg, 'label', '');
  const max = readNumber(cfg, 'max', 100);
  const value =
    typeof props.data === 'object' && props.data !== null && 'value' in props.data
      ? Number((props.data as { value: unknown }).value)
      : readNumber(cfg, 'value', 0);

  return <FlowIndicator balance={value} max={max} label={label || undefined} />;
}

function renderChart(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const chartType = readString(cfg, 'chartType', 'bar') as
    | 'line' | 'bar' | 'pie' | 'area' | 'radar' | 'circular';
  const xKey = readString(cfg, 'xKey', 'name');
  const seriesCfg = Array.isArray(cfg['series'])
    ? (cfg['series'] as Array<{ key: string; label?: string }>)
    : [];
  const items = Array.isArray(props.data)
    ? (props.data as Array<Record<string, unknown>>)
    : [];

  if (items.length === 0) {
    return <EmptyBlock message="Нет данных для графика" />;
  }

  return (
    <Chart
      type={chartType}
      data={items}
      config={{
        xKey,
        series: seriesCfg.length > 0 ? seriesCfg : [{ key: 'value', label: 'Значение' }],
      }}
      height={220}
    />
  );
}

function renderMap(props: WidgetProps): ReactElement {
  const cfg = mergedConfig(props.widget, props.instance);
  const zoom = readNumber(cfg, 'zoom', 10);
  const items = Array.isArray(props.data)
    ? (props.data as Array<{ id?: string; lat: number; lon: number; label?: string; type?: string }>)
    : [];

  const markers = items
    .filter((i) => typeof i.lat === 'number' && typeof i.lon === 'number')
    .map((i, idx) => ({
      id: i.id ?? String(idx),
      lat: i.lat,
      lon: i.lon,
      label: i.label ?? 'Marker',
      type: (i.type ?? 'community') as
        | 'participant' | 'cell' | 'community' | 'crisis' | 'cultural_center' | 'gateway',
    }));

  return <LeafletMap markers={markers} zoom={zoom} height={280} />;
}

function renderTimeline(props: WidgetProps): ReactElement {
  const items = Array.isArray(props.data) ? (props.data as ItemShape[]) : [];
  if (items.length === 0) {return <EmptyBlock message="Нет событий" />;}

  return (
    <div style={styles.timeline}>
      {items.map((item, i) => (
        <div key={item.id ?? i} style={styles.timelineRow}>
          <div style={styles.timelineDot} />
          <div style={styles.timelineContent}>
            <div style={styles.timelineTitle}>
              {item.title ?? item.name ?? `Событие ${i + 1}`}
            </div>
            {item.value !== undefined ? (
              <div style={styles.timelineValue}>{String(item.value)}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderTree(props: WidgetProps): ReactElement {
  const items = Array.isArray(props.data) ? (props.data as TreeItem[]) : [];
  if (items.length === 0) {return <EmptyBlock message="Дерево пусто" />;}

  return (
    <div style={styles.tree}>
      {items.map((item, i) => (
        <TreeNodeView key={item.id ?? i} node={item} depth={0} />
      ))}
    </div>
  );
}

interface TreeItem {
  id?: string;
  title?: string;
  label?: string;
  children?: TreeItem[];
}

function TreeNodeView({ node, depth }: { node: TreeItem; depth: number }): ReactElement {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  return (
    <div>
      <div
        style={{
          ...styles.treeRow,
          paddingLeft: 8 + depth * 16,
        }}
      >
        {hasChildren ? '▸' : '·'}{' '}
        {node.title ?? node.label ?? node.id ?? '—'}
      </div>
      {children.map((c, i) => (
        <TreeNodeView key={c.id ?? i} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function renderPlaceholder(props: WidgetProps): ReactElement {
  return (
    <div style={styles.placeholder}>
      <Badge tone="warning">{`Виджет ${props.widget.type}`}</Badge>
      <p style={styles.placeholderText}>
        Тип «{props.widget.type}» ещё не реализован в реестре
      </p>
      <p style={styles.placeholderHint}>
        entity: {props.widget.entity}
      </p>
    </div>
  );
}

// ─── Реестр ──────────────────────────────────────────────────────

export const WIDGET_REGISTRY: Record<string, ComponentType<WidgetProps>> = {
  list: renderList,
  table: renderTable,
  card: renderCard,
  metric: renderMetric,
  progress: renderProgress,
  circular: renderCircular,
  chart: renderChart,
  map: renderMap,
  timeline: renderTimeline,
  tree: renderTree,
};

export const KNOWN_WIDGET_TYPES = [
  'list', 'table', 'card', 'metric', 'progress', 'circular',
  'chart', 'map', 'timeline', 'tree',
  'calendar', 'graph', 'button', 'form', 'chat', 'video',
] as const;

// ─── ErrorBoundary ───────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class WidgetErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error('Widget crashed:', error, info);
    this.setState({ hasError: true, error });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={styles.errorBlock}>
          <strong>Ошибка виджета</strong>
          <div style={styles.errorText}>{this.state.error?.message ?? 'Unknown'}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Loading / Empty ─────────────────────────────────────────────

export function WidgetLoading(): ReactElement {
  return (
    <div style={styles.loadingBlock}>
      <div style={styles.spinnerDot} />
      <span>Загрузка…</span>
    </div>
  );
}

export function WidgetEmpty({ message }: { message: string }): ReactElement {
  return <EmptyBlock message={message} />;
}

function EmptyBlock({ message }: { message: string }): ReactElement {
  return (
    <div style={styles.emptyBlock}>
      <span style={styles.emptyText}>{message}</span>
    </div>
  );
}

// ─── Widget (обёртка) ───────────────────────────────────────────

export function Widget(props: WidgetProps): ReactElement {
  const Component = WIDGET_REGISTRY[props.widget.type] ?? renderPlaceholder;
  return (
    <WidgetErrorBoundary>
      <div style={styles.widgetRoot}>
        <Component {...props} />
      </div>
    </WidgetErrorBoundary>
  );
}

// ─── WidgetShell (карточка вокруг виджета) ──────────────────────

export interface WidgetShellProps {
  title: string;
  onRemove?: () => void;
  onSelect?: () => void;
  selected?: boolean;
  dragHandleClassName?: string;
  /** Если задан — на корневой div вешается data-canvas-region. */
  canvasRegion?: string;
  /** Куда ведёт раздел (клик по заголовку и кнопка «Открыть»). */
  openHref?: string | null;
  children: ReactNode;
}

export function WidgetShell({
  title,
  onRemove,
  onSelect,
  selected,
  dragHandleClassName,
  canvasRegion,
  openHref,
  children,
}: WidgetShellProps): ReactElement {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{ ...styles.shell, ...(selected ? styles.shellSelected : {}) }}
      onClick={onSelect}
      {...(canvasRegion ? { 'data-canvas-region': canvasRegion } : {})}
    >
      <div
        style={styles.shellHeader}
        className={dragHandleClassName ?? ''}
      >
        <span
          style={{ ...styles.shellTitle, ...(openHref ? styles.shellTitleLink : {}) }}
          onClick={(e) => {
            if (!openHref) {return;}
            e.stopPropagation();
            navigate(openHref);
          }}
          title={openHref ? 'Открыть раздел' : undefined}
        >
          {title}
        </span>
        <span style={styles.shellActions}>
        <button
          type="button"
          style={styles.shellIcon}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label="Развернуть виджет"
          title="Развернуть"
        >
          ⤢
        </button>
        {openHref ? (
          <button
            type="button"
            style={styles.shellIcon}
            onClick={(e) => {
              e.stopPropagation();
              navigate(openHref);
            }}
            aria-label="Открыть раздел"
            title="Открыть раздел"
          >
            →
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            style={styles.shellRemove}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Удалить виджет"
          >
            ×
          </button>
        ) : null}
        </span>
      </div>
      <div style={styles.shellBody}>{children}</div>
      {expanded ? (
        <div
          style={styles.expandOverlay}
          onClick={() => setExpanded(false)}
        >
          <div style={styles.expandCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shellHeader}>
              <span style={styles.shellTitle}>{title}</span>
              <span style={styles.shellActions}>
                {openHref ? (
                  <button
                    type="button"
                    style={styles.shellIcon}
                    onClick={() => navigate(openHref)}
                  >
                    →
                  </button>
                ) : null}
                <button
                  type="button"
                  style={styles.shellIcon}
                  onClick={() => setExpanded(false)}
                  aria-label="Свернуть"
                >
                  ×
                </button>
              </span>
            </div>
            <div style={styles.expandBody}>{children}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  widgetRoot: {
    width: '100%',
    height: '100%',
    display: 'flex' as const,
    flexDirection: 'column' as const,
  },
  shell: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    height: '100%',
    width: '100%',
    background: colors.bgSoft,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
  },
  shellSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  shellHeader: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
    background: colors.bg,
    cursor: 'move' as const,
    userSelect: 'none' as const,
  },
  shellTitle: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  shellTitleLink: { cursor: 'pointer' as const, textDecoration: 'underline dotted' },
  shellActions: { display: 'flex', alignItems: 'center', gap: 6 },
  shellIcon: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    cursor: 'pointer' as const,
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
  },
  expandOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  expandCard: {
    width: '92vw',
    height: '88vh',
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden' as const,
  },
  expandBody: {
    flex: 1,
    padding: spacing.md,
    overflow: 'auto' as const,
    minHeight: 0,
  },
  shellRemove: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    cursor: 'pointer' as const,
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  },
  shellBody: {
    flex: 1,
    padding: spacing.sm,
    overflow: 'auto' as const,
    minHeight: 0,
  },
  list: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  listRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listTitle: { flex: 1 },
  listValue: { color: colors.textMuted, fontWeight: 600 },
  cardGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: spacing.sm,
  },
  cardField: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 2,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 500,
  },
  timeline: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeft: `2px solid ${colors.borderSoft}`,
  },
  timelineRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'flex-start' as const,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: colors.primary,
    marginTop: 6,
    marginLeft: -13,
    flexShrink: 0,
  },
  timelineContent: { flex: 1 },
  timelineTitle: { color: colors.text, fontSize: fontSize.sm },
  timelineValue: { color: colors.textMuted, fontSize: fontSize.xs },
  tree: { display: 'flex' as const, flexDirection: 'column' as const },
  treeRow: {
    padding: '3px 0',
    fontSize: fontSize.sm,
    color: colors.text,
    cursor: 'default' as const,
  },
  placeholder: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    padding: spacing.md,
    height: '100%',
    textAlign: 'center' as const,
  },
  placeholderText: {
    color: colors.text,
    fontSize: fontSize.sm,
    margin: 0,
  },
  placeholderHint: {
    color: colors.textDim,
    fontSize: fontSize.xs,
    margin: 0,
  },
  loadingBlock: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.sm,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    height: '100%',
  },
  spinnerDot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: `2px solid ${colors.border}`,
    borderTopColor: colors.primary,
    animation: 'xartia-spin 0.8s linear infinite',
  },
  emptyBlock: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.md,
    height: '100%',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  errorBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    padding: spacing.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: radius.sm,
    color: colors.danger,
    fontSize: fontSize.sm,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
};