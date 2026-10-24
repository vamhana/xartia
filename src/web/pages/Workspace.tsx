// F.4.98.01 — Workspace page.
// Рабочая панель участника. Поддерживает несколько панелей через
// переключатель-табы. Автопереключение контекста по WS-событиям режимов.

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PanelCanvas } from '../components/ui/PanelCanvas';
import type {
  ScreenSize,
  ZoomLevel,
} from '../components/ui/PanelCanvas.constants';
import { Spinner } from '../components/ui/Spinner';
import type { WidgetContext } from '../components/ui/Widget';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

interface Panel {
  id: string;
  name: string;
  roleId: string | null;
  directionId: string | null;
  context: WidgetContext;
  version: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface WidgetInstanceRow {
  id: string;
  panelId: string;
  widgetId: string;
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

interface AvailablePanel {
  id: string;
  name: string;
  context: WidgetContext;
}

interface RenderResponse {
  data: {
    panel: Panel | null;
    instances: WidgetInstanceRow[];
    widgets: WidgetLibEntry[];
    widgetData: Record<string, unknown>;
    missingEntities: string[];
    failedEntities: string[];
    available: AvailablePanel[];
  };
}

// ─── Константы ───────────────────────────────────────────────────

const SIZE_PRESETS = {
  XS: { w: 3, h: 3, label: 'Крошечный' },
  S:  { w: 4, h: 3, label: 'Малый' },
  M:  { w: 6, h: 4, label: 'Средний' },
  L:  { w: 8, h: 5, label: 'Большой' },
  XL: { w: 12, h: 6, label: 'Во всю ширину' },
};

const CONTEXT_LABEL: Record<WidgetContext, string> = {
  normal: 'Обычный',
  crisis: 'Кризис',
  steel_bell: 'Стальной Колокол',
};

const CONTEXT_TONE: Record<WidgetContext, 'info' | 'warning' | 'danger'> = {
  normal: 'info',
  crisis: 'warning',
  steel_bell: 'danger',
};

const LAST_PANEL_KEY = 'xartia.workspace.lastPanelId';

function regimesToContext(activeTypes: string[]): WidgetContext {
  if (activeTypes.includes('steel_bell')) {return 'steel_bell';}
  if (
    activeTypes.includes('red_circuit') ||
    activeTypes.includes('global_red_circuit')
  ) {
    return 'crisis';
  }
  return 'normal';
}

function pickScreenSize(): ScreenSize {
  if (typeof window === 'undefined') {return 'laptop';}
  const w = window.innerWidth;
  if (w >= 1400) {return 'desktop';}
  if (w >= 1024) {return 'laptop';}
  if (w >= 768) {return 'tablet';}
  return 'mobile';
}

// ─── Workspace ───────────────────────────────────────────────────

export function WorkspacePage(): ReactElement {
  const [activeRegimes, setActiveRegimes] = useState<string[]>([]);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(LAST_PANEL_KEY);
      } catch {
        return null;
      }
    },
  );

  const context = regimesToContext(activeRegimes);
  const screenSize = useMemo(() => pickScreenSize(), []);
  const zoom: ZoomLevel = 1;

  // Если panel_id есть — грузим его; иначе — дефолтную по контексту.
  const path = selectedPanelId
    ? `/panels/me/render?panel_id=${selectedPanelId}`
    : `/panels/me/render?context=${context}`;

  const renderQ = useApiQuery<RenderResponse>(
    ['workspace', 'render', selectedPanelId ?? '', context],
    path,
    { refetchInterval: 60_000 },
  );

  // WS: regimes
  useWSSubscription('regimes', (event, payload) => {
    const p = payload as { type?: string } | null;
    const regimeType = p?.type;
    if (!regimeType) {return;}

    if (event === 'regime.activated') {
      setActiveRegimes((rs) => (rs.includes(regimeType) ? rs : [...rs, regimeType]));
    } else if (event === 'regime.deactivated') {
      setActiveRegimes((rs) => rs.filter((t) => t !== regimeType));
    }
  });

  const payload = renderQ.data?.data;
  const panel = payload?.panel ?? null;
  const instances = payload?.instances ?? [];
  const available = payload?.available ?? [];
  const widgetData = payload?.widgetData ?? {};
  const widgets = useMemo(() => {
    const m = new Map<string, WidgetLibEntry>();
    for (const w of payload?.widgets ?? []) {m.set(w.id, w);}
    return m;
  }, [payload]);

  // Синхронизируем selectedPanelId с сервером:
  // если сервер вернул панель, отличную от выбранной — доверяем серверу.
  useEffect(() => {
    if (!panel) {return;}
    if (panel.id === selectedPanelId) {return;}
    setSelectedPanelId(panel.id);
    try {
      localStorage.setItem(LAST_PANEL_KEY, panel.id);
    } catch {
      /* ignore */
    }
  }, [panel, selectedPanelId]);

  // Автосброс stale panel_id: если backend вернул 404 (панель удалена,
  // БД сброшена, панель распубликована), чистим localStorage и стейт —
  // запрос уйдёт заново без panel_id, отработает по context.
  useEffect(() => {
    if (!renderQ.isError) {return;}
    const err = renderQ.error as { status?: number } | null;
    if (err?.status !== 404) {return;}
    try {
      localStorage.removeItem(LAST_PANEL_KEY);
    } catch {
      /* ignore */
    }
    setSelectedPanelId(null);
  }, [renderQ.isError, renderQ.error]);

  const onSelectPanel = (id: string): void => {
    setSelectedPanelId(id);
    try {
      localStorage.setItem(LAST_PANEL_KEY, id);
    } catch {
      /* ignore */
    }
  };

  if (renderQ.isLoading) {
    return <Spinner label="Загружаем рабочую панель…" />;
  }

  if (renderQ.isError) {
    return (
      <Card title="Ошибка">
        <p style={styles.muted}>Не удалось загрузить рабочую панель.</p>
      </Card>
    );
  }

  if (!panel) {
    return (
      <Card title="Рабочая панель не назначена">
        <p style={styles.muted}>
          Для вашей роли и направления пока не опубликовано ни одной панели.
          Попросите Архитектора или Совет собрать панель в{' '}
          <a href="/constructor" style={styles.link}>
            Конструкторе
          </a>
          .
        </p>
      </Card>
    );
  }

  // Группируем available по контексту, чтобы показать все доступные табы
  // даже если они не в текущем контексте.
  const others = available.filter((p) => p.id !== panel.id);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.h1}>{panel.name}</h1>
          <div style={styles.meta}>
            <Badge tone={CONTEXT_TONE[panel.context]}>
              {CONTEXT_LABEL[panel.context]}
            </Badge>
            <span style={styles.muted}>v{panel.version}</span>
            {panel.context !== context ? (
              <span style={styles.hintBadge}>
                Активный режим: {CONTEXT_LABEL[context]}
              </span>
            ) : null}
          </div>
        </div>

        <div style={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void renderQ.refetch()}
          >
            Обновить
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.href = '/constructor';
            }}
          >
            Настроить
          </Button>
        </div>
      </div>

      {/* Переключатель панелей — только если их больше одной */}
      {others.length > 0 ? (
        <div style={styles.tabs}>
          <span style={styles.tabsLabel}>Панели:</span>
          {[panel, ...others].map((p) => {
            const isActive = p.id === panel.id;
            const isCtx = p.context === context;
            return (
              <button
                key={p.id}
                type="button"
                style={{
                  ...styles.tab,
                  ...(isActive ? styles.tabActive : {}),
                  ...(!isActive && isCtx ? styles.tabCurrentCtx : {}),
                }}
                onClick={() => onSelectPanel(p.id)}
              >
                {p.name}
                <span style={styles.tabContext}>· {CONTEXT_LABEL[p.context]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {(payload?.missingEntities?.length || payload?.failedEntities?.length) ? (
        <div style={styles.warnBanner}>
          {payload?.missingEntities?.length ? (
            <span>
              Нет loader'ов для: {payload.missingEntities.join(', ')}
            </span>
          ) : null}
          {payload?.failedEntities?.length ? (
            <span>
              Ошибки loader'ов: {payload.failedEntities.join(', ')}
            </span>
          ) : null}
        </div>
      ) : null}

      <PanelCanvas
        instances={instances}
        widgets={widgets}
        widgetData={widgetData}
        context={context}
        screenSize={screenSize}
        zoom={zoom}
        sizePresets={SIZE_PRESETS}
        defaultSize="S"
        interactive={false}
        bare
      />
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
    height: '100%',
  },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    flexWrap: 'wrap' as const,
  },
  headerLeft: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  headerActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  h1: { margin: 0, fontSize: fontSize.xxl, color: colors.text },
  meta: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  hintBadge: {
    color: colors.warning,
    fontSize: fontSize.xs,
    padding: '2px 8px',
    borderRadius: radius.sm,
    background: 'rgba(245,158,11,0.12)',
    border: '1px solid rgba(245,158,11,0.3)',
  },
  link: { color: colors.primary, textDecoration: 'underline' as const },
  tabs: {
    display: 'flex' as const,
    gap: spacing.xs,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    paddingBottom: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  tabsLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginRight: spacing.sm,
  },
  tab: {
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 12px',
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  tabActive: {
    background: colors.primary,
    borderColor: colors.primary,
    color: '#fff',
  },
  tabCurrentCtx: {
    borderColor: colors.primary,
    color: colors.primary,
  },
  tabContext: {
    fontSize: fontSize.xs,
    opacity: 0.7,
  },
  warnBanner: {
    display: 'flex' as const,
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    background: 'rgba(245,158,11,0.10)',
    border: '1px solid rgba(245,158,11,0.30)',
    color: colors.warning,
    fontSize: fontSize.xs,
    flexWrap: 'wrap' as const,
  },
} as const;