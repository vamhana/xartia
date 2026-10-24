// F.4.99.27 |Frontend|UI|React|src/web/components/ui/PanelCanvas.tsx|F.4.99.01, F.4.99.05, F.4.99.12|v.0.0.04|Draft|VIII.1|
//
// - Screen size меняет только ширину RGL (одна 12-колоночная сетка).
// - Zoom — визуальный слой: CSS transform на внешней обёртке + positionStrategy
//   со scale, чтобы drag/resize учитывали масштаб.
// - Рекурсия: если у виджета type='container', PanelCanvas рендерится внутри
//   себя как вложенная сетка. Все инстансы панели передаются одним массивом,
//   каждый уровень фильтрует своих прямых детей по parentId.
// - Drop из палитры обслуживает DndManager (useDndManager). Каждый PanelCanvas
//   регистрируется под ключом parentId (null для корня) и коммитит drop
//   только для своего parentId. DndManager сам находит регион под курсором
//   по атрибуту data-canvas-region: ближайший предок от elementFromPoint
//   с этим атрибутом; для корня значение '__root__', для контейнера — inst.id.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { GridLayout } from 'react-grid-layout';
import type { Position , Layout, LayoutItem } from 'react-grid-layout';
import { setTransform } from 'react-grid-layout/core';

// ⚠️ Путь к DndManager — подставь фактический.
import { colors, fontSize, radius, spacing } from '../../theme';

import { useDndManager } from './DndManager';
import {
  COLS,
  BASE_ROW_HEIGHT,
  CANVAS_PADDING,
  GRID_MARGIN,
  SCREEN_SIZES,
  MAX_DEPTH,
  DRAG_HANDLE_CLASS,
  type ZoomLevel,
  type ScreenSize,
} from './PanelCanvas.constants.js';
import { Spinner } from './Spinner';
import {
  Widget as WidgetRenderer,
  WidgetShell,
  type WidgetContext,
  type WidgetInstanceRef,
  type WidgetLibraryEntry,
} from './Widget';

/**
 * Человеческие заголовки виджетов. Без них в шапке карточки было
 * «table · tasks» — техническая пара, а не название рабочего блока.
 * Отдельный оверрайд конкретной панели имеет приоритет (см. widgetTitle).
 */
const WIDGET_TITLES: Record<string, string> = {
  'table/tasks': 'Задачи',
  'table/my_tasks': 'Мои задачи',
  'table/otc_queue': 'Очередь на проверку',
  'list/signals': 'Сигналы',
  'card/passport': 'Паспорт',
  'metric/flows': 'Потоки',
  'metric/total_flow': 'Поток всего',
  'progress/capsule': 'Капсула Потока',
  'chart/balance': 'Баланс',
  'tree/cells': 'Ячейки',
  'timeline/archive': 'Архив',
  'map/communities': 'Общины',
  'circular/regimes': 'Режимы',
  'container/layout': 'Контейнер',
};

/** Что делать, если данных нет — вместо пустой рамки. */
const EMPTY_HINTS: Record<string, string> = {
  my_tasks: 'Задач нет. Возьмите задачу из очереди направления на странице «Задачи».',
  tasks: 'Задач пока нет. Создайте задачу или дождитесь плана направления.',
  otc_queue: 'Очередь пуста — проверять нечего. Хороший момент, чтобы взять задачу.',
  signals: 'Сигналов нет. Если есть проблема или идея — подайте сигнал.',
  flows: 'Потоков пока нет: они начисляются за принятые задачи.',
  balance: 'Баланс не рассчитан — нет принятых задач за период.',
  capsule: 'Капсула пуста: положите туда излишек Потока.',
  cells: 'Ячеек нет — направление ещё не собрало группы.',
  archive: 'Архив пуст: сюда попадают завершённые задачи и решения.',
  communities: 'Общин нет — планетарный уровень ещё не начат.',
  regimes: 'Активных режимов нет — обычный контур.',
  passport: 'Паспорт недоступен: обновите страницу.',
};

/** Пусто ли значение для виджета: null, [], {data: []} и т.п. */
function isWidgetDataEmpty(data: unknown): boolean {
  if (data === null || data === undefined) {return true;}
  if (Array.isArray(data)) {return data.length === 0;}
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const inner = obj['data'];
    if (Array.isArray(inner)) {return inner.length === 0;}
    const rows = obj['rows'];
    if (Array.isArray(rows)) {return rows.length === 0;}
    // Объект из одних пустых значений тоже считаем пустым.
    const values = Object.values(obj).filter((v) => v !== null && v !== undefined);
    return values.length === 0;
  }
  return false;
}

// Реэкспорт для обратной совместимости с потребителями
// (Workspace, Constructor). Внутри они импортируются из .constants.js,
// но если где-то остался старый импорт — продолжит работать.
// ВАЖНО: этот реэкспорт всё равно ломает Fast Refresh. Убрать
// его отсюда, если хочешь чистый HMR — потребители должны
// импортировать напрямую из .constants.
export type { ZoomLevel, ScreenSize };

/** Sentinel-значение data-canvas-region для корневого холста. */
const ROOT_REGION = '__root__';


// ─── Типы ────────────────────────────────────────────────────────

interface WidgetInstanceRow {
  id: string;
  panelId: string;
  widgetId: string;
  /** null = корень панели; uuid = внутри контейнера-родителя. */
  parentId: string | null;
  position: Record<string, unknown>;
  size: Record<string, unknown>;
  overrides: Record<string, unknown>;
  createdAt: string;
}

interface WidgetLibEntry {
  id: string;
  type: string;
  entity: string;
  config: Record<string, unknown>;
  defaultRights: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

interface SizePresetCfg {
  w: number;
  h: number;
  label: string;
}

export interface PanelCanvasProps {
  /** ВСЕ инстансы панели — фильтрация по parentId внутри. */
  instances: WidgetInstanceRow[];
  /** null = корень; uuid = внутри контейнера. */
  parentId?: string | null;
  widgets: Map<string, WidgetLibEntry>;
  widgetData?: Record<string, unknown>;
  context: WidgetContext;
  screenSize: ScreenSize;
  zoom: ZoomLevel;
  sizePresets: Record<string, SizePresetCfg>;
  defaultSize: string;

  loading?: boolean;
  /** Интерактивный режим: drag/resize/select/remove/drop. */
  interactive?: boolean;
  selectedInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  onRemoveInstance?: (id: string) => void;
  /**
   * RGL v2 передаёт сюда Event (в рантайме это MouseEvent на dragStop
   * и MouseEvent/TouchEvent на resizeStop). Тип расширяем до Event —
   * потребитель проверяет наличие clientX сам.
   */
  onLayoutCommit?: (item: LayoutItem, e?: Event) => void;
  /**
   * Drop из палитры. Четвёртый аргумент — parentId холста, на который
   * упал виджет. null = корень панели.
   */
  onDropWidget?: (
    layout: Layout,
    item: LayoutItem | undefined,
    e: Event,
    parentId: string | null,
  ) => void;
  droppingItem?: LayoutItem;

  chromeLabel?: string;
  emptyMessage?: string;
  /** Runtime-режим: без chrome-полосы, без рамки, без тени. */
  bare?: boolean;
  /** Уровень вложенности. 0 = корень. Не задавать руками. */
  depth?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function readNum(o: Record<string, unknown>, k: string, fallback: number): number {
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) {return v;}
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) {return n;}
  }
  return fallback;
}

function toLayout(
  inst: WidgetInstanceRow,
  presets: Record<string, SizePresetCfg>,
  defaultSize: string,
): LayoutItem {
  const def = presets[defaultSize] ?? { w: 3, h: 3 };
  return {
    i: inst.id,
    x: readNum(inst.position, 'x', 0),
    y: readNum(inst.position, 'y', 0),
    w: readNum(inst.size, 'w', def.w),
    h: readNum(inst.size, 'h', def.h),
  };
}

/**
 * Достаёт данные для конкретного instance. Ключ в widgetData может быть:
 *   - `${entity}:${instanceId}` — для instance-scoped loader'ов
 *   - `${entity}`               — для entity-scoped loader'ов (кэш по entity)
 * Instance-scoped приоритетнее.
 */
function resolveWidgetData(
  map: Record<string, unknown>,
  entity: string,
  instanceId: string,
): unknown {
  const specific = `${entity}:${instanceId}`;
  if (specific in map) {return map[specific];}
  if (entity in map) {return map[entity];}
  return undefined;
}

// ─── Компонент ───────────────────────────────────────────────────

export function PanelCanvas(props: PanelCanvasProps): ReactElement {

  const {
    instances,
    parentId = null,
    widgets,
    widgetData = {},
    context,
    screenSize,
    zoom,
    sizePresets,
    defaultSize,
    loading,
    interactive = false,
    selectedInstanceId = null,
    onSelectInstance,
    onRemoveInstance,
    onLayoutCommit,
    onDropWidget,
    droppingItem,
    chromeLabel,
    emptyMessage = 'Перетащите виджет из палитры на экран',
    bare = false,
    depth = 0,
  } = props;

  const isNested = depth > 0;
  const screen = SCREEN_SIZES[screenSize];

  // Прямые дети этого уровня
  const myInstances = useMemo(
    () => instances.filter((i) => (i.parentId ?? null) === parentId),
    [instances, parentId],
  );

  // Layout для RGL — только для этого уровня
  const layout: Layout = useMemo(
    () => myInstances.map((i) => toLayout(i, sizePresets, defaultSize)),
    [myInstances, sizePresets, defaultSize],
  );

  // ─── Ширина: корень — из screenSize, вложенный — измеряется через RO ───

  const measureRef = useRef<HTMLDivElement>(null);
  const rootDropRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(
    SCREEN_SIZES[screenSize].w - 2 * CANVAS_PADDING,
  );
  const [dropPreview, setDropPreview] = useState<
    { x: number; y: number; w: number; h: number } | null
  >(null);

  // Live-значения для стабильных effect-ов и колбеков DndManager.
  const myInstancesRef = useRef(myInstances);
  myInstancesRef.current = myInstances;

  const onDropWidgetRef = useRef(onDropWidget);
  onDropWidgetRef.current = onDropWidget;

  const sizePresetsRef = useRef(sizePresets);
  sizePresetsRef.current = sizePresets;

  const defaultSizeRef = useRef(defaultSize);
  defaultSizeRef.current = defaultSize;

  // ─── Замер ширины вложенного контейнера (ResizeObserver) ─────────
  useEffect(() => {
    if (!isNested) {return;}
    const el = measureRef.current;
    if (!el) {return;}
    const measure = (): void => {
      const w = Math.max(120, Math.floor(el.clientWidth));
      setMeasuredWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isNested]);

  // ─── Расчёты размеров ────────────────────────────────────────────
  const gridWidth = isNested
    ? measuredWidth
    : SCREEN_SIZES[screenSize].w - 2 * CANVAS_PADDING;

  const effectiveZoom: number = isNested ? 1 : zoom;

  const positionStrategy = useMemo(
    () => ({
      type: 'transform' as const,
      scale: effectiveZoom,
      calcStyle: (pos: Position) => setTransform(pos),
    }),
    [effectiveZoom],
  );

  const defaultPreset = useMemo(
    () => sizePresets[defaultSize] ?? { w: 3, h: 3 },
    [sizePresets, defaultSize],
  );

  const rows = useMemo(() => {
    let max = 1;
    for (const it of layout) {max = Math.max(max, it.y + it.h);}
    return max;
  }, [layout]);

  const contentRows =
    rows * (BASE_ROW_HEIGHT + GRID_MARGIN[1]) + 2 * CANVAS_PADDING;
  const totalH = isNested ? contentRows : Math.max(screen.h, contentRows);
  const totalW = isNested ? measuredWidth : screen.w;

  // ─── Drop из палитры: регистрация в DndManager ───────────────────
  //
  // Ключ владельца — parentId (null для корня, uuid контейнера для
  // вложенного). DndManager сам определяет регион под курсором по
  // data-canvas-region (см. renderItem и <main>), а координаты drop-а
  // считаются от coordEl: <main> для корня, measureRef для вложенного.

  const dnd = useDndManager();

  useEffect(() => {
    if (!interactive || !onDropWidget || !dnd) {return;}

    const coordEl = isNested ? measureRef.current : rootDropRef.current;
    if (!coordEl) {return;}

    const compute = (
      cx: number,
      cy: number,
    ): { x: number; y: number; w: number; h: number } => {
      const rect = coordEl.getBoundingClientRect();
      const colWidth = (rect.width - GRID_MARGIN[0] * (COLS - 1)) / COLS;
      const rowStep = BASE_ROW_HEIGHT + GRID_MARGIN[1];
      const w = defaultPreset.w;
      const h = defaultPreset.h;
      let x = Math.floor((cx - rect.left) / (colWidth + GRID_MARGIN[0]));
      let y = Math.floor((cy - rect.top) / rowStep);
      x = Math.max(0, Math.min(COLS - w, x));
      y = Math.max(0, y);
      return { x, y, w, h };
    };

    const unregister = dnd.register({
      parentId: parentId ?? null,
      depth,
      computeDrop: compute,
      commitDrop: (cx, cy, e) => {
        const p = compute(cx, cy);
        // TODO: убрать console.log перед коммитом.
        console.warn('[commitDrop]', {
          isNested,
          depth,
          parentId,   // null для корня; uuid контейнера — для вложенного
          cx,
          cy,
          x: p.x, y: p.y, w: p.w, h: p.h,
        });

        const payload =
          e.dataTransfer?.getData('application/x-xartia-widget') ??
          e.dataTransfer?.getData('text/plain') ??
          '';
        if (!payload) {return;}

        const item: LayoutItem = {
          i: '__dropping__',
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
        };
        const nextLayout: Layout = myInstancesRef.current.map((i) =>
          toLayout(i, sizePresetsRef.current, defaultSizeRef.current),
        );
        onDropWidgetRef.current?.(nextLayout, item, e, parentId ?? null);
      },
      setPreview: setDropPreview,
    });

    return unregister;
  }, [
    interactive,
    dnd,
    isNested,
    parentId,
    depth,
    defaultPreset.w,
    defaultPreset.h,
    // onDropWidget / sizePresets / defaultSize — через ref'ы, НЕ в deps.
  ]);

  // ─── Один item ───────────────────────────────────────────────────
  const renderItem = (inst: WidgetInstanceRow): ReactElement => {
    const w = widgets.get(inst.widgetId);
    const isSelected = inst.id === selectedInstanceId;
    const handleSelect = onSelectInstance
      ? (): void => onSelectInstance(inst.id)
      : undefined;

    if (!w) {
      return (
        <div key={inst.id}>
          <WidgetShell
            title="Виджет не найден"
            selected={isSelected}
            {...(handleSelect ? { onSelect: handleSelect } : {})}
          >
            <div style={styles.muted}>
              widgetId: {inst.widgetId.slice(0, 8)}…
            </div>
          </WidgetShell>
        </div>
      );
    }

    const isContainer = w.type === 'container';
    const canDescend = depth < MAX_DEPTH;

    // Данные для листовых виджетов. Контейнеры не имеют данных.
    const data = isContainer
      ? undefined
      : resolveWidgetData(widgetData, w.entity, inst.id);

    const widgetTitle =
      typeof inst.overrides?.['title'] === 'string' && inst.overrides['title']
        ? String(inst.overrides['title'])
        : (WIDGET_TITLES[`${w.type}/${w.entity}`] ?? `${w.type} · ${w.entity}`);

    return (
      <div key={inst.id}>
        <WidgetShell
          title={widgetTitle}
          selected={isSelected}
          dragHandleClassName={DRAG_HANDLE_CLASS}
          // Маркер региона: DndManager ищет closest('[data-canvas-region]')
          // от точки drop-а. Для контейнера — inst.id; для листа — не ставим.
          canvasRegion={isContainer ? inst.id : undefined}
          {...(handleSelect ? { onSelect: handleSelect } : {})}
          {...(interactive && onRemoveInstance
            ? { onRemove: (): void => onRemoveInstance(inst.id) }
            : {})}
        >
          {isContainer && canDescend ? (
            <PanelCanvas
              instances={instances}
              parentId={inst.id}
              widgets={widgets}
              widgetData={widgetData}
              context={context}
              screenSize={screenSize}
              zoom={1}
              sizePresets={sizePresets}
              defaultSize={defaultSize}
              interactive={interactive}
              selectedInstanceId={selectedInstanceId}
              {...(onSelectInstance ? { onSelectInstance } : {})}
              {...(onRemoveInstance ? { onRemoveInstance } : {})}
              {...(onLayoutCommit ? { onLayoutCommit } : {})}
              {...(onDropWidget ? { onDropWidget } : {})}
              {...(droppingItem ? { droppingItem } : {})}
              emptyMessage="Перетащите виджет в контейнер"
              depth={depth + 1}
            />
          ) : isContainer ? (
            <div style={styles.muted}>
              Достигнута максимальная вложенность ({MAX_DEPTH})
            </div>
          ) : (
            isWidgetDataEmpty(data) ? (
              // Пустая рамка выглядит как поломка. Лучше честный empty-state
              // с подсказкой, что делать дальше.
              <div style={styles.emptyState}>
                <div style={styles.emptyTitle}>
                  {WIDGET_TITLES[`${w.type}/${w.entity}`] ?? 'Нет данных'}
                </div>
                <div style={styles.emptyHint}>
                  {EMPTY_HINTS[w.entity] ?? 'Данных пока нет'}
                </div>
              </div>
            ) : (
              <WidgetRenderer
                instance={inst as unknown as WidgetInstanceRef}
                widget={w as unknown as WidgetLibraryEntry}
                context={context}
                data={data}
              />
            )
          )}
        </WidgetShell>
      </div>
    );
  };

  // На корне — drag за любое место. Внутри контейнера — только за header,
  // иначе внешний RGL перехватывает mousedown во внутренней области.
  const dragCfg = interactive
    ? isNested
      ? { enabled: true, handle: `.${DRAG_HANDLE_CLASS}` }
      : { enabled: true }
    : { enabled: false };

  const dropPreviewStyle = useMemo(() => {
    if (!dropPreview) {return null;}
    const cols = COLS;
    const colWidth = (gridWidth - GRID_MARGIN[0] * (cols - 1)) / cols;
    const rowStep = BASE_ROW_HEIGHT + GRID_MARGIN[1];
    const left = dropPreview.x * (colWidth + GRID_MARGIN[0]);
    const top = dropPreview.y * rowStep;
    const width = dropPreview.w * colWidth + (dropPreview.w - 1) * GRID_MARGIN[0];
    const height = dropPreview.h * BASE_ROW_HEIGHT + (dropPreview.h - 1) * GRID_MARGIN[1];
    return { left, top, width, height };
  }, [dropPreview, gridWidth]);

  // ─── Общий GridLayout ────────────────────────────────────────────
  const grid = (
    <GridLayout
      className="layout"
      width={gridWidth}
      layout={layout}
      gridConfig={{
        cols: COLS,
        rowHeight: BASE_ROW_HEIGHT,
        margin: GRID_MARGIN,
        containerPadding: [0, 0],
      }}
      positionStrategy={positionStrategy}
      dragConfig={dragCfg}
      resizeConfig={{ handles: ['se'], enabled: interactive }}
      onDragStop={(_l, _old, next, _placeholder, e) => {
        if (next && onLayoutCommit) {onLayoutCommit(next, e);}
      }}
      onResizeStop={(_l, _old, next, _placeholder, e) => {
        if (next && onLayoutCommit) {onLayoutCommit(next, e);}
      }}
    >
      {myInstances.map(renderItem)}
    </GridLayout>
  );

  const emptyOverlay =
    myInstances.length === 0 ? (
      <div style={isNested ? styles.nestedEmpty : styles.canvasScreenEmpty}>
        {emptyMessage}
      </div>
    ) : null;

  // ─── Вложенный холст ─────────────────────────────────────────────
  if (isNested) {
    return (
      <div
        ref={measureRef}
        style={styles.nestedRoot}
        onMouseDownCapture={(e) => {
          const t = e.target as HTMLElement;
          console.warn('[nested mousedown]', {
            inHandle: !!t.closest?.(`.${DRAG_HANDLE_CLASS}`),
            tag: t.tagName,
            cls: t.className,
          });
        }}
        onMouseDown={(e) => {
          // Пропускаем mousedown к внешнему RGL только когда он по хэндлу
          // вложенного виджета. Пустое место контейнера по-прежнему
          // тащит сам контейнер.
          const t = e.target as HTMLElement;
          if (t.closest?.(`.${DRAG_HANDLE_CLASS}`)) {
            e.stopPropagation();
          }
        }}
      >
        {loading ? (
          <Spinner label="Загружаем…" />
        ) : (
          <div style={styles.nestedInner}>
            {grid}
            {dropPreviewStyle ? (
              <div
                style={{
                  position: 'absolute',
                  pointerEvents: 'none',
                  background: 'rgba(96,165,250,0.20)',
                  border: '2px dashed rgba(96,165,250,0.6)',
                  borderRadius: radius.sm,
                  zIndex: 5,
                  ...dropPreviewStyle,
                }}
              />
            ) : null}
            {emptyOverlay}
          </div>
        )}
      </div>
    );
  }

  // ─── Корневой холст ──────────────────────────────────────────────
  return (
    <main
      ref={rootDropRef}
      data-canvas-region={ROOT_REGION}
      style={bare ? styles.canvasBare : styles.canvasViewport}
    >
      {loading ? (
        <Spinner label="Загружаем виджеты…" />
      ) : (
        <div
          style={{
            width: totalW * zoom,
            height: totalH * zoom,
            position: 'relative',
          }}
        >
          <div
            style={{
              width: totalW,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            {bare ? (
              <div style={styles.canvasScreenContent}>
                {grid}
                {dropPreviewStyle ? (
                  <div
                    style={{
                      position: 'absolute',
                      pointerEvents: 'none',
                      background: 'rgba(96,165,250,0.20)',
                      border: '2px dashed rgba(96,165,250,0.6)',
                      borderRadius: radius.sm,
                      zIndex: 5,
                      ...dropPreviewStyle,
                    }}
                  />
                ) : null}
                {emptyOverlay}
              </div>
            ) : (
              <div style={styles.canvasScreen}>
                <div style={styles.canvasScreenChrome}>
                  <span style={styles.canvasScreenDot} />
                  <span style={{ ...styles.canvasScreenDot, background: '#f59e0b' }} />
                  <span style={{ ...styles.canvasScreenDot, background: '#10b981' }} />
                  <span style={styles.canvasScreenUrl}>
                    {chromeLabel ??
                      `charter.local/constructor · ${screen.w}×${screen.h}`}
                  </span>
                </div>

                <div style={styles.canvasScreenContent}>
                  {grid}
                  {dropPreviewStyle ? (
                    <div
                      style={{
                        position: 'absolute',
                        pointerEvents: 'none',
                        background: 'rgba(96,165,250,0.20)',
                        border: '2px dashed rgba(96,165,250,0.6)',
                        borderRadius: radius.sm,
                        zIndex: 5,
                        ...dropPreviewStyle,
                      }}
                    />
                  ) : null}
                  {emptyOverlay}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  canvasViewport: {
    position: 'relative' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    overflow: 'auto' as const,
    padding: spacing.md,
    minHeight: 0,
    flex: 1,
  },
  canvasBare: {
    position: 'relative' as const,
    minHeight: 0,
    flex: 1,
    overflow: 'auto' as const,
  },
  canvasScreen: {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    position: 'relative' as const,
  },
  canvasScreenChrome: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.borderSoft}`,
    background: colors.bgSoft,
  },
  canvasScreenDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#ef4444',
    flexShrink: 0,
  },
  canvasScreenUrl: {
    marginLeft: spacing.sm,
    color: colors.textDim,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  canvasScreenContent: {
    position: 'relative' as const,
    padding: CANVAS_PADDING,
  },
  canvasScreenEmpty: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: colors.textMuted,
    fontSize: fontSize.sm,
    pointerEvents: 'none' as const,
    textAlign: 'center' as const,
    lineHeight: 1.6,
  },
  nestedRoot: {
    width: '100%' as const,
    height: '100%' as const,
    overflow: 'auto' as const,
    padding: 4,
    boxSizing: 'border-box' as const,
  },
  nestedInner: {
    position: 'relative' as const,
    minHeight: 20,
  },
  nestedEmpty: {
    position: 'absolute' as const,
    top: '50%' as const,
    left: '50%' as const,
    transform: 'translate(-50%, -50%)',
    color: colors.textMuted,
    fontSize: fontSize.xs,
    pointerEvents: 'none' as const,
    textAlign: 'center' as const,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 6,
    padding: spacing.md,
    textAlign: 'center' as const,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: 500 },
  emptyHint: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 1.5 },
} as const;