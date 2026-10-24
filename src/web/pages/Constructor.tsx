// F.4.02.18 — Constructor page.
// Трёхколоночный редактор панелей. RGL v2 API.
// Единый рендер сетки через <PanelCanvas>: screen size → ширина контейнера,
// zoom → transform: scale + transformScale. Drag за любое место виджета,
// клик выделяет.
//
// Drag-n-drop из палитры работает через глобальный DndProvider:
// ConstructorPage оборачивается в него целиком, чтобы покрыть и основной
// PanelCanvas, и PanelCanvas внутри модалки предпросмотра.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Layout, LayoutItem } from 'react-grid-layout';

import { apiPost, apiPatch, apiDelete } from '../api/client';
import type { ApiError } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { DndProvider } from '../components/ui/DndManager';
import { PanelCanvas } from '../components/ui/PanelCanvas';
import {
  SCREEN_SIZES,
  ZOOM_LEVELS,
  type ScreenSize,
  type ZoomLevel,
} from '../components/ui/PanelCanvas.constants';
import { Spinner } from '../components/ui/Spinner';
import type { WidgetContext } from '../components/ui/Widget';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Пресеты размеров ────────────────────────────────────────────
// w=4 при 12 колонках = 1/3 ширины, w=6 = половина, w=8 = 2/3, w=12 = вся ширина.

type SizePreset = 'XS' | 'S' | 'M' | 'L' | 'XL';

const SIZE_PRESETS: Record<SizePreset, { w: number; h: number; label: string }> = {
  XS: { w: 3, h: 3, label: 'Крошечный' },
  S:  { w: 4, h: 3, label: 'Малый' },
  M:  { w: 6, h: 4, label: 'Средний' },
  L:  { w: 8, h: 5, label: 'Большой' },
  XL: { w: 12, h: 6, label: 'Во всю ширину' },
};

const DEFAULT_SIZE: SizePreset = 'S';

const DROPPING_ITEM_BASE: Omit<LayoutItem, 'w' | 'h'> = {
  i: '__dropping__',
  x: 0,
  y: 0,
};

// ─── Типы backend ────────────────────────────────────────────────

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

interface WidgetLibEntry {
  id: string;
  type: string;
  entity: string;
  config: Record<string, unknown>;
  defaultRights: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
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

interface PanelVersionRow {
  id: string;
  panelId: string;
  version: number;
  snapshot: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

interface DirectionBrief {
  id: string;
  number: number;
  name: string;
}

interface RoleItem {
  id: string;
  directionId: string;
  directionName: string;
  name: string;
  type: string;
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

// ─── Видимость панели ────────────────────────────────────────────

interface VisibilityInfo {
  icon: string;
  label: string;
  tone: 'info' | 'success' | 'warning';
}

function describePanelVisibility(
  panel: Panel,
  directions: DirectionBrief[],
  roles: RoleItem[],
): VisibilityInfo {
  const parts: string[] = [];
  let icon = '🌐';
  let tone: VisibilityInfo['tone'] = 'success';

  if (panel.directionId) {
    const d = directions.find((x) => x.id === panel.directionId);
    parts.push(d ? `Направление №${d.number}` : 'Направление ?');
    icon = '📍';
    tone = 'warning';
  }
  if (panel.roleId) {
    const r = roles.find((x) => x.id === panel.roleId);
    parts.push(r ? `Роль ${r.name}` : 'Роль ?');
    icon = panel.directionId ? '📍🎭' : '🎭';
    tone = 'warning';
  }
  if (parts.length === 0) {
    return { icon: '🌐', label: 'Видна всем', tone: 'success' };
  }
  return { icon, label: parts.join(' · '), tone };
}

// ─── ModalShell ──────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
  wide,
  fullscreen,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  fullscreen?: boolean;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={onClose} role="dialog">
      <div
        style={{
          ...styles.modal,
          ...(wide ? { minWidth: 640 } : {}),
          ...(fullscreen ? styles.modalFullscreen : {}),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{title}</span>
          <button
            type="button"
            style={styles.modalClose}
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ─── PanelForm ───────────────────────────────────────────────────

interface PanelFormProps {
  mode: 'create' | 'edit';
  initial?: Panel;
  directions: DirectionBrief[];
  roles: RoleItem[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    context: WidgetContext;
    directionId: string | null;
    roleId: string | null;
  }) => void;
}

function PanelForm({
  mode,
  initial,
  directions,
  roles,
  busy,
  error,
  onCancel,
  onSubmit,
}: PanelFormProps): ReactElement {
  const [name, setName] = useState(initial?.name ?? '');
  const [context, setContext] = useState<WidgetContext>(
    initial?.context ?? 'normal',
  );
  const [directionId, setDirectionId] = useState<string>(initial?.directionId ?? '');
  const [roleId, setRoleId] = useState<string>(initial?.roleId ?? '');

  const filteredRoles = useMemo(
    () =>
      directionId ? roles.filter((r) => r.directionId === directionId) : roles,
    [roles, directionId],
  );

  useEffect(() => {
    if (!roleId) {return;}
    const stillValid = filteredRoles.some((r) => r.id === roleId);
    if (!stillValid) {setRoleId('');}
  }, [filteredRoles, roleId]);

  const visibility = useMemo(() => {
    if (!directionId && !roleId) {
      return {
        icon: '🌐',
        text: 'Панель будет видна всем участникам без ограничений',
        tone: 'ok' as const,
      };
    }
    const parts: string[] = [];
    if (directionId) {
      const d = directions.find((x) => x.id === directionId);
      parts.push(
        d
          ? `только участникам Направления №${d.number} ${d.name}`
          : 'только участникам выбранного направления',
      );
    }
    if (roleId) {
      const r = filteredRoles.find((x) => x.id === roleId);
      parts.push(r ? `с ролью ${r.name}` : 'с выбранной ролью');
    }
    return {
      icon: directionId && roleId ? '📍🎭' : directionId ? '📍' : '🎭',
      text: `Панель будет видна ${parts.join(' и ')}`,
      tone: 'warn' as const,
    };
  }, [directionId, roleId, directions, filteredRoles]);

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <ModalShell
      title={mode === 'create' ? 'Новая панель' : 'Свойства панели'}
      onClose={onCancel}
    >
      <div style={styles.field}>
        <label style={styles.fieldLabel}>
          Название <span style={styles.required}>*</span>
        </label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Панель Совета"
          autoFocus
        />
      </div>

      <div style={styles.field}>
        <label style={styles.fieldLabel}>Направление</label>
        <select
          style={styles.input}
          value={directionId}
          onChange={(e) => setDirectionId(e.target.value)}
        >
          <option value="">— не привязана —</option>
          {directions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.number}. {d.name}
            </option>
          ))}
        </select>
        <span style={styles.fieldHint}>
          Панель показывается только участникам этого направления.
        </span>
      </div>

      <div style={styles.field}>
        <label style={styles.fieldLabel}>Роль</label>
        <select
          style={styles.input}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          disabled={filteredRoles.length === 0}
        >
          <option value="">
            {directionId
              ? '— без привязки к роли —'
              : '— выберите направление, чтобы отфильтровать —'}
          </option>
          {filteredRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.directionName})
            </option>
          ))}
        </select>
      </div>

      <div style={styles.field}>
        <label style={styles.fieldLabel}>Контекст</label>
        <select
          style={styles.input}
          value={context}
          onChange={(e) => setContext(e.target.value as WidgetContext)}
        >
          <option value="normal">Обычный</option>
          <option value="crisis">Кризис</option>
          <option value="steel_bell">Стальной Колокол</option>
        </select>
      </div>

      <div
        style={{
          ...styles.visibilityHint,
          ...(visibility.tone === 'ok'
            ? styles.visibilityHintOk
            : styles.visibilityHintWarn),
        }}
      >
        <span style={{ fontSize: 16 }}>{visibility.icon}</span>
        <span>{visibility.text}</span>
      </div>

      {error ? <div style={styles.errorBlock}>{error}</div> : null}

      <div style={styles.modalActions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              context,
              directionId: directionId || null,
              roleId: roleId || null,
            })
          }
        >
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
      </div>
    </ModalShell>
  );
}

// ─── WidgetProperties ────────────────────────────────────────────

interface PropertyRow {
  key: string;
  value: string;
}

function widgetConfigToRows(
  config: Record<string, unknown>,
  overrides: Record<string, unknown>,
): PropertyRow[] {
  const merged = { ...config, ...overrides };
  const rows: PropertyRow[] = [];
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) {continue;}
    if (typeof v === 'object' && v !== null) {continue;}
    rows.push({ key: k, value: String(v) });
  }
  return rows;
}

function WidgetProperties({
  instance,
  widget,
  canEdit,
  onSave,
  busy,
}: {
  instance: WidgetInstanceRow;
  widget: WidgetLibEntry;
  canEdit: boolean;
  onSave: (overrides: Record<string, unknown>) => void;
  busy: boolean;
}): ReactElement {
  const [rows, setRows] = useState<PropertyRow[]>(() =>
    widgetConfigToRows(widget.config, instance.overrides),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedJson, setAdvancedJson] = useState(() =>
    JSON.stringify(instance.overrides ?? {}, null, 2),
  );
  const [dirty, setDirty] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(widgetConfigToRows(widget.config, instance.overrides));
    setAdvancedJson(JSON.stringify(instance.overrides ?? {}, null, 2));
    setDirty(false);
    setLocalErr(null);
  }, [instance.id, instance.overrides, widget.config]);

  const setRow = (i: number, patch: Partial<PropertyRow>): void => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = (): void => {
    setRows((rs) => [...rs, { key: '', value: '' }]);
    setDirty(true);
  };
  const removeRow = (i: number): void => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const onSaveClick = (): void => {
    setLocalErr(null);
    const overrides: Record<string, unknown> = {};
    if (advancedOpen) {
      try {
        Object.assign(overrides, JSON.parse(advancedJson) as Record<string, unknown>);
      } catch (e) {
        setLocalErr(`Advanced JSON: ${(e as Error).message}`);
        return;
      }
    }
    for (const r of rows) {
      if (!r.key.trim()) {continue;}
      const cfgVal = widget.config[r.key];
      let val: unknown = r.value;
      if (typeof cfgVal === 'number') {
        const n = Number(r.value);
        if (Number.isFinite(n)) {val = n;}
      } else if (typeof cfgVal === 'boolean') {
        val = r.value === 'true' || r.value === '1';
      }
      const same = String(cfgVal ?? '') === String(val);
      if (!same || instance.overrides[r.key] !== undefined) {
        overrides[r.key] = val;
      }
    }
    onSave(overrides);
    setDirty(false);
  };

  const onResetClick = (): void => {
    setRows(widgetConfigToRows(widget.config, {}));
    setAdvancedJson('{}');
    setDirty(true);
  };

  return (
    <div style={styles.propsBody}>
      <div style={styles.propRow}>
        <span style={styles.propLabel}>Тип</span>
        <span style={styles.propValue}>{widget.type}</span>
      </div>
      <div style={styles.propRow}>
        <span style={styles.propLabel}>Entity</span>
        <span style={styles.propValue}>{widget.entity}</span>
      </div>
      <div style={styles.propRow}>
        <span style={styles.propLabel}>Instance</span>
        <span style={styles.propValueMono}>{instance.id.slice(0, 8)}…</span>
      </div>

      <div style={styles.divider} />

      <div style={styles.fieldLabel}>Настройки</div>

      <div style={styles.kvList}>
        {rows.map((r, i) => (
          <div key={i} style={styles.kvRow}>
            <input
              style={styles.kvKey}
              value={r.key}
              onChange={(e) => setRow(i, { key: e.target.value })}
              placeholder="ключ"
              disabled={!canEdit}
            />
            <input
              style={styles.kvValue}
              value={r.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
              placeholder="значение"
              disabled={!canEdit}
            />
            {canEdit ? (
              <button
                type="button"
                style={styles.kvRemove}
                onClick={() => removeRow(i)}
                aria-label="Удалить"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canEdit ? (
        <button type="button" style={styles.addRowBtn} onClick={addRow}>
          + Добавить поле
        </button>
      ) : null}

      <div style={styles.divider} />

      <button
        type="button"
        style={styles.advancedToggle}
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        {advancedOpen ? '▼' : '▶'} Advanced JSON
      </button>

      {advancedOpen ? (
        <textarea
          style={styles.jsonEditor}
          rows={8}
          value={advancedJson}
          onChange={(e) => {
            setAdvancedJson(e.target.value);
            setDirty(true);
          }}
          disabled={!canEdit}
        />
      ) : null}

      {localErr ? <div style={styles.errorBlock}>{localErr}</div> : null}

      {canEdit ? (
        <div style={styles.propsActions}>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={busy || !dirty}
            onClick={onSaveClick}
          >
            {dirty ? 'Сохранить' : 'Сохранено'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onResetClick}
          >
            Сбросить
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── VersionsModal ───────────────────────────────────────────────

function VersionsModal({
  versions,
  loading,
  onClose,
  onRollback,
  busy,
}: {
  versions: PanelVersionRow[];
  loading: boolean;
  onClose: () => void;
  onRollback: (version: number) => void;
  busy: boolean;
}): ReactElement {
  return (
    <ModalShell title="Версии панели" onClose={onClose}>
      {loading ? (
        <Spinner label="Загружаем версии…" />
      ) : versions.length === 0 ? (
        <div style={styles.muted}>Версий пока нет — опубликуйте панель.</div>
      ) : (
        <div style={styles.versionList}>
          {versions.map((v) => (
            <div key={v.id} style={styles.versionRow}>
              <div>
                <span style={styles.versionNumber}>v{v.version}</span>{' '}
                <span style={styles.muted}>
                  {new Date(v.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onRollback(v.version)}
              >
                Откатить
              </Button>
            </div>
          ))}
        </div>
      )}
      <div style={styles.modalActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Закрыть
        </Button>
      </div>
    </ModalShell>
  );
}

// ─── PanelPreview ────────────────────────────────────────────────

function PanelPreview({
  panel,
  instances,
  widgets,
  onClose,
}: {
  panel: Panel;
  instances: WidgetInstanceRow[];
  widgets: Map<string, WidgetLibEntry>;
  onClose: () => void;
}): ReactElement {
  const [context, setContext] = useState<WidgetContext>(panel.context);

  return (
    <ModalShell
      title={`Предпросмотр — ${panel.name}`}
      onClose={onClose}
      fullscreen
    >
      <div style={styles.previewToolbar}>
        <span style={styles.toolbarLabel}>Контекст:</span>
        {(Object.keys(CONTEXT_LABEL) as WidgetContext[]).map((c) => (
          <button
            key={c}
            type="button"
            style={{
              ...styles.ctxBtn,
              ...(context === c ? styles.ctxBtnActive : {}),
            }}
            onClick={() => setContext(c)}
          >
            {CONTEXT_LABEL[c]}
          </button>
        ))}
        <div style={styles.spacer} />
        <span style={styles.muted}>
          {instances.length} виджетов · v{panel.version}
        </span>
      </div>

      <div style={styles.previewViewport}>
        <PanelCanvas
          instances={instances}
          widgets={widgets}
          context={context}
          screenSize="laptop"
          zoom={1}
          sizePresets={SIZE_PRESETS}
          defaultSize={DEFAULT_SIZE}
          interactive={false}
          chromeLabel={`Предпросмотр · ${CONTEXT_LABEL[context]}`}
          emptyMessage="Панель пуста"
        />
      </div>
    </ModalShell>
  );
}

// ─── ConstructorPage ─────────────────────────────────────────────

export function ConstructorPage(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();

  const canCreate = rights.hasRight('panel', 'C');
  const canEdit = rights.hasRight('panel', 'E');
  const canDelete = rights.hasRight('panel', 'D');
  const canPublish = rights.hasRight('panel', 'A');

  // ─── State ────────────────────────────────────────────────────
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [previewContext, setPreviewContext] = useState<WidgetContext>('normal');
  const [creatingPanel, setCreatingPanel] = useState(false);
  const [editingPanel, setEditingPanel] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [screenSize, setScreenSize] = useState<ScreenSize>('laptop');
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);
  const [zoomBeforeFullscreen, setZoomBeforeFullscreen] = useState<ZoomLevel>(1);

  // ─── Запросы ──────────────────────────────────────────────────
  const panelsQ = useApiQuery<{ data: Panel[] }>(
    ['constructor', 'panels'],
    '/panels',
  );

  const libraryQ = useApiQuery<{ data: WidgetLibEntry[] }>(
    ['constructor', 'widgets'],
    '/widgets',
  );

  const directionsQ = useApiQuery<{ data: DirectionBrief[] }>(
    ['directions', 'list'],
    '/directions',
  );

  const rolesQ = useApiQuery<{ data: RoleItem[] }>(
    ['roles', 'list'],
    '/roles',
  );

  const panelQ = useApiQuery<Panel>(
    ['constructor', 'panel', selectedPanelId],
    `/panels/${selectedPanelId ?? ''}`,
    { enabled: !!selectedPanelId },
  );

  const instancesQ = useApiQuery<{ data: WidgetInstanceRow[] }>(
    ['constructor', 'instances', selectedPanelId],
    `/panels/${selectedPanelId ?? ''}/widgets`,
    { enabled: !!selectedPanelId },
  );

  const versionsQ = useApiQuery<{ data: PanelVersionRow[] }>(
    ['constructor', 'versions', selectedPanelId],
    `/panels/${selectedPanelId ?? ''}/versions`,
    { enabled: !!selectedPanelId && showVersions },
  );

  // ─── Автовыбор ────────────────────────────────────────────────
  useEffect(() => {
    if (selectedPanelId) {return;}
    const first = panelsQ.data?.data?.[0];
    if (first) {setSelectedPanelId(first.id);}
  }, [panelsQ.data, selectedPanelId]);

  useEffect(() => {
    setSelectedInstanceId(null);
  }, [selectedPanelId]);

  useEffect(() => {
    if (panelQ.data) {setPreviewContext(panelQ.data.context);}
  }, [panelQ.data]);

  // ─── Fullscreen-режим холста: F — вход/выход, Esc — выход ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape' && canvasFullscreen) {
        // не перехватываем Esc, если открыт модал — пусть закроет модал
        if (creatingPanel || editingPanel || showVersions || showPreview) {return;}
        setCanvasFullscreen(false);
        setZoom(zoomBeforeFullscreen);
        return;
      }

      if (inField) {return;}

      if ((e.key === 'f' || e.key === 'F') && selectedPanelId) {
        e.preventDefault();
        if (!canvasFullscreen) {
          setZoomBeforeFullscreen(zoom);
          setZoom(1);
          setCanvasFullscreen(true);
        } else {
          setCanvasFullscreen(false);
          setZoom(zoomBeforeFullscreen);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canvasFullscreen,
    zoom,
    zoomBeforeFullscreen,
    selectedPanelId,
    creatingPanel,
    editingPanel,
    showVersions,
    showPreview,
  ]);

  // ─── Мутации ──────────────────────────────────────────────────
  const createPanelM = useMutation({
    mutationFn: (input: {
      name: string;
      context: WidgetContext;
      directionId: string | null;
      roleId: string | null;
    }) =>
      apiPost<Panel>('/panels', {
        name: input.name,
        context: input.context,
        ...(input.directionId ? { direction_id: input.directionId } : {}),
        ...(input.roleId ? { role_id: input.roleId } : {}),
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['constructor', 'panels'] });
      setSelectedPanelId(p.id);
      setCreatingPanel(false);
      setMsg('Панель создана');
      setErr(null);
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  const updatePanelM = useMutation({
    mutationFn: (input: {
      panelId: string;
      name: string;
      context: WidgetContext;
      directionId: string | null;
      roleId: string | null;
    }) =>
      apiPatch<Panel>(`/panels/${input.panelId}`, {
        name: input.name,
        context: input.context,
        direction_id: input.directionId,
        role_id: input.roleId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['constructor', 'panels'] });
      void qc.invalidateQueries({
        queryKey: ['constructor', 'panel', selectedPanelId],
      });
      setEditingPanel(false);
      setMsg('Панель обновлена');
      setErr(null);
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  const deletePanelM = useMutation({
    mutationFn: (panelId: string) => apiDelete<void>(`/panels/${panelId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['constructor', 'panels'] });
      setSelectedPanelId(null);
      setMsg('Панель удалена');
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  const addWidgetM = useMutation({
    mutationFn: (vars: {
      widgetId: string;
      parentId?: string | null;
      position: Record<string, unknown>;
      size: Record<string, unknown>;
    }) =>
      apiPost<WidgetInstanceRow>(`/panels/${selectedPanelId}/widgets`, {
        widget_id: vars.widgetId,
        position: vars.position,
        size: vars.size,
        ...(vars.parentId !== undefined ? { parent_id: vars.parentId } : {}),
      }),
    onSuccess: (inst) => {
      void qc.invalidateQueries({
        queryKey: ['constructor', 'instances', selectedPanelId],
      });
      setSelectedInstanceId(inst.id);
      setMsg('Виджет добавлен');
      setErr(null);
    },
    onError: (e: unknown) => {
      console.error('[Constructor] addWidget failed:', e);
      setErr((e as ApiError).message);
    },
  });

  const updateWidgetM = useMutation({
    mutationFn: (vars: {
      instanceId: string;
      parentId?: string | null;
      position?: Record<string, unknown>;
      size?: Record<string, unknown>;
      overrides?: Record<string, unknown>;
    }) =>
      apiPatch<WidgetInstanceRow>(
        `/panels/${selectedPanelId}/widgets/${vars.instanceId}`,
        {
          ...(vars.parentId !== undefined ? { parent_id: vars.parentId } : {}),
          ...(vars.position ? { position: vars.position } : {}),
          ...(vars.size ? { size: vars.size } : {}),
          ...(vars.overrides ? { overrides: vars.overrides } : {}),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['constructor', 'instances', selectedPanelId],
      });
    },
    onError: (e: unknown) => {
      console.error('[Constructor] updateWidget failed:', e);
      setErr((e as ApiError).message);
    },
  });

  const deleteWidgetM = useMutation({
    mutationFn: (instanceId: string) =>
      apiDelete<void>(`/panels/${selectedPanelId}/widgets/${instanceId}`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['constructor', 'instances', selectedPanelId],
      });
      setSelectedInstanceId(null);
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  const publishM = useMutation({
    mutationFn: () => apiPost<Panel>(`/panels/${selectedPanelId}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['constructor', 'panel', selectedPanelId],
      });
      void qc.invalidateQueries({ queryKey: ['constructor', 'panels'] });
      void qc.invalidateQueries({
        queryKey: ['constructor', 'versions', selectedPanelId],
      });
      setMsg('Панель опубликована');
      setErr(null);
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  const rollbackM = useMutation({
    mutationFn: (version: number) =>
      apiPost<Panel>(`/panels/${selectedPanelId}/rollback/${version}`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['constructor', 'panel', selectedPanelId],
      });
      void qc.invalidateQueries({
        queryKey: ['constructor', 'versions', selectedPanelId],
      });
      setMsg('Откат выполнен');
    },
    onError: (e: unknown) => setErr((e as ApiError).message),
  });

  // ─── Производные ──────────────────────────────────────────────
  const widgetById = useMemo(() => {
    const m = new Map<string, WidgetLibEntry>();
    for (const w of libraryQ.data?.data ?? []) {m.set(w.id, w);}
    return m;
  }, [libraryQ.data]);

  const containerWidget = useMemo(
    () =>
      libraryQ.data?.data?.find((w) => w.type === 'container') ?? null,
    [libraryQ.data],
  );

  const instances = instancesQ.data?.data ?? [];

  const filteredPalette = useMemo(() => {
    const all = libraryQ.data?.data ?? [];
    const q = paletteFilter.trim().toLowerCase();
    if (!q) {return all;}
    return all.filter(
      (w) =>
        w.type.toLowerCase().includes(q) ||
        w.entity.toLowerCase().includes(q),
    );
  }, [libraryQ.data, paletteFilter]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  function findContainerAtPoint(cx: number, cy: number): string | null {
    const els = document.elementsFromPoint(cx, cy);
    for (const el of els) {
      // Пропускаем сам перетаскиваемый виджет — он под курсором верхним слоем.
      if ((el as HTMLElement).closest?.('.react-draggable-dragging')) {continue;}
      const region = (el as HTMLElement).closest?.('[data-canvas-region]');
      if (!region) {continue;}
      const id = region.getAttribute('data-canvas-region');
      if (!id || id === '__root__') {break;}       // дошли до корня — контейнера нет
      return id;                                  // это uuid контейнера
    }
    return null;
  }
  // ─── Persist item ─────────────────────────────────────────────
  const persistLayoutItem = useCallback(
    (item: LayoutItem, e?: Event) => {
        const inst = instances.find((x) => x.id === item.i);
      if (!inst) {return;}

      const currentParentId = inst.parentId ?? null;

      // Куда упал курсор?
      let targetContainerId: string | null = null;
      if (e && 'clientX' in e && typeof (e as MouseEvent).clientX === 'number') {
        const me = e as MouseEvent;
        targetContainerId = findContainerAtPoint(me.clientX, me.clientY);
      }
      const newParentId = targetContainerId;

      if (newParentId !== currentParentId) {
        // Переносим в другой контейнер (или на корень)
        updateWidgetM.mutate({
          instanceId: item.i,
          parentId: newParentId,
          position: { x: item.x, y: item.y },
          size: { w: item.w, h: item.h },
        });
        return;
      }

      // Тот же уровень — обычный commit позиции
      const px = readNum(inst.position, 'x', 0);
      const py = readNum(inst.position, 'y', 0);
      const pw = readNum(inst.size, 'w', SIZE_PRESETS[DEFAULT_SIZE].w);
      const ph = readNum(inst.size, 'h', SIZE_PRESETS[DEFAULT_SIZE].h);
      if (px === item.x && py === item.y && pw === item.w && ph === item.h) {return;}
      updateWidgetM.mutate({
        instanceId: item.i,
        position: { x: item.x, y: item.y },
        size: { w: item.w, h: item.h },
      });
    },
    [instances, updateWidgetM],
  );

  const onDrop = useCallback(
    (
      _layout: Layout,
      item: LayoutItem | undefined,
      e: Event,
      parentId: string | null,
    ) => {
      const de = e as DragEvent;
      const payload =
        de.dataTransfer?.getData('application/x-xartia-widget') ??
        de.dataTransfer?.getData('text/plain') ??
        '';

      console.warn('[Constructor.onDrop] entered', {
        parentId,
        item,
        hasPayload: !!payload,
        selectedPanelId,
      });

      if (!payload || !item || !selectedPanelId) {
        console.warn('[Constructor.onDrop] bailed', {
          reason: !payload ? 'no payload'
                : !item   ? 'no item'
                : 'no selectedPanelId',
        });
        return;
      }

      console.warn('[Constructor.onDrop] commit', {
        widgetId: payload,
        parentId,
        position: { x: item.x, y: item.y },
        size: { w: item.w, h: item.h },
      });

      addWidgetM.mutate({
        widgetId: payload,
        parentId,
        position: { x: item.x, y: item.y },
        size: { w: item.w, h: item.h },
      });
    },
    [addWidgetM, selectedPanelId],
  );

  // ─── Fallback: добавить кликом ────────────────────────────────
  const addWidgetAtEnd = useCallback(
    (widgetId: string, preset: SizePreset = DEFAULT_SIZE) => {
      if (!selectedPanelId) {return;}
      const sz = SIZE_PRESETS[preset];
      const roots = instances.filter((i) => i.parentId === null);
      const maxY = roots.reduce((acc, inst) => {
        const y = readNum(inst.position, 'y', 0);
        const h = readNum(inst.size, 'h', sz.h);
        return Math.max(acc, y + h);
      }, 0);
      addWidgetM.mutate({
        widgetId,
        parentId: null,
        position: { x: 0, y: maxY },
        size: { w: sz.w, h: sz.h },
      });
    },
    [addWidgetM, instances, selectedPanelId],
  );

  const setWidgetSize = (instanceId: string, preset: SizePreset): void => {
    const sz = SIZE_PRESETS[preset];
    updateWidgetM.mutate({
      instanceId,
      size: { w: sz.w, h: sz.h },
    });
  };

  // ─── Guard ────────────────────────────────────────────────────
  if (panelsQ.isLoading || libraryQ.isLoading) {
    return <Spinner label="Загружаем Конструктор…" />;
  }

  const currentPanel = panelQ.data;

  const droppingItem: LayoutItem = {
    ...DROPPING_ITEM_BASE,
    w: SIZE_PRESETS[DEFAULT_SIZE].w,
    h: SIZE_PRESETS[DEFAULT_SIZE].h,
  };

  return (
    <DndProvider>
      <div style={styles.page}>
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h1 style={styles.h1}>Конструктор панелей</h1>
            {currentPanel ? (() => {
              const v = describePanelVisibility(
                currentPanel,
                directionsQ.data?.data ?? [],
                rolesQ.data?.data ?? [],
              );
              return (
                <div style={styles.panelMeta}>
                  <Badge tone={CONTEXT_TONE[currentPanel.context]}>
                    {CONTEXT_LABEL[currentPanel.context]}
                  </Badge>
                  <span style={styles.muted}>
                    v{currentPanel.version} ·{' '}
                    {currentPanel.active ? 'опубликована' : 'черновик'}
                  </span>
                  <span
                    style={{
                      ...styles.visibilityBadge,
                      ...(v.tone === 'warning'
                        ? styles.visibilityBadgeWarn
                        : styles.visibilityBadgeOk),
                    }}
                    title={
                      v.tone === 'success'
                        ? 'Панель видна всем участникам'
                        : 'Панель видна только ограниченному кругу'
                    }
                  >
                    {v.icon} {v.label}
                  </span>
                </div>
              );
            })() : null}
          </div>

          <div style={styles.headerActions}>
            <select
              style={styles.panelSelect}
              value={selectedPanelId ?? ''}
              onChange={(e) => setSelectedPanelId(e.target.value || null)}
            >
              <option value="">— выберите панель —</option>
              {(panelsQ.data?.data ?? []).map((p) => {
                const v = describePanelVisibility(
                  p,
                  directionsQ.data?.data ?? [],
                  rolesQ.data?.data ?? [],
                );
                return (
                  <option key={p.id} value={p.id}>
                    {v.icon} {p.name} {p.active ? '· опубл.' : '· черновик'}
                  </option>
                );
              })}
            </select>

            {canCreate ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreatingPanel(true)}
              >
                + Панель
              </Button>
            ) : null}

            {selectedPanelId && canEdit && containerWidget ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={addWidgetM.isPending}
                onClick={() => {
                  const roots = instances.filter((i) => i.parentId === null);
                  const maxY = roots.reduce((acc, inst) => {
                    const y = readNum(inst.position, 'y', 0);
                    const h = readNum(inst.size, 'h', 10);
                    return Math.max(acc, y + h);
                  }, 0);
                  addWidgetM.mutate({
                    widgetId: containerWidget.id,
                    parentId: null,
                    position: { x: 0, y: maxY },
                    size: { w: 12, h: 10 },
                  });
                }}
                title="Добавить контейнер во всю ширину в конец панели"
              >
                📦 Контейнер
              </Button>
            ) : null}

            {selectedPanelId && canEdit && currentPanel ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditingPanel(true)}
              >
                ⚙ Свойства
              </Button>
            ) : null}

            {selectedPanelId && currentPanel ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPreview(true)}
              >
                👁 Предпросмотр
              </Button>
            ) : null}

            {selectedPanelId && canPublish ? (
              <Button
                variant="primary"
                size="sm"
                loading={publishM.isPending}
                disabled={publishM.isPending || !currentPanel}
                onClick={() => publishM.mutate()}
              >
                Опубликовать
              </Button>
            ) : null}

            {selectedPanelId ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowVersions(true)}
              >
                Версии
              </Button>
            ) : null}

            {selectedPanelId && canDelete && currentPanel && !currentPanel.active ? (
              <Button
                variant="danger"
                size="sm"
                disabled={deletePanelM.isPending}
                onClick={() => {
                  if (confirm('Удалить панель? Действие необратимо.')) {
                    deletePanelM.mutate(selectedPanelId);
                  }
                }}
              >
                Удалить
              </Button>
            ) : null}
          </div>
        </div>

        {/* ─── Toolbar ────────────────────────────────────────────── */}
        {selectedPanelId ? (
          <div style={styles.toolbar}>
            <span style={styles.toolbarLabel}>Экран:</span>
            {(Object.keys(SCREEN_SIZES) as ScreenSize[]).map((s) => (
              <button
                key={s}
                type="button"
                style={{
                  ...styles.ctxBtn,
                  ...(screenSize === s ? styles.ctxBtnActive : {}),
                }}
                onClick={() => setScreenSize(s)}
                title={`${SCREEN_SIZES[s].w}×${SCREEN_SIZES[s].h}`}
              >
                {SCREEN_SIZES[s].icon} {SCREEN_SIZES[s].label}
              </button>
            ))}

            <span style={{ ...styles.toolbarLabel, marginLeft: spacing.md }}>
              Масштаб:
            </span>
            {ZOOM_LEVELS.map((z) => (
              <button
                key={z}
                type="button"
                style={{
                  ...styles.ctxBtn,
                  ...(zoom === z ? styles.ctxBtnActive : {}),
                }}
                onClick={() => setZoom(z)}
              >
                {Math.round(z * 100)}%
              </button>
            ))}

            <span style={{ ...styles.toolbarLabel, marginLeft: spacing.md }}>
              Контекст:
            </span>
            {(Object.keys(CONTEXT_LABEL) as WidgetContext[]).map((c) => (
              <button
                key={c}
                type="button"
                style={{
                  ...styles.ctxBtn,
                  ...(previewContext === c ? styles.ctxBtnActive : {}),
                }}
                onClick={() => setPreviewContext(c)}
              >
                {CONTEXT_LABEL[c]}
              </button>
            ))}

            <button
              type="button"
              style={{
                ...styles.ctxBtn,
                ...(canvasFullscreen ? styles.ctxBtnActive : {}),
                marginLeft: spacing.md,
              }}
              onClick={() => {
                if (!canvasFullscreen) {
                  setZoomBeforeFullscreen(zoom);
                  setZoom(1);
                  setCanvasFullscreen(true);
                } else {
                  setCanvasFullscreen(false);
                  setZoom(zoomBeforeFullscreen);
                }
              }}
              title={
                canvasFullscreen
                  ? 'Выйти из полноэкранного режима (Esc)'
                  : 'Развернуть холст на весь экран (F)'
              }
            >
              {canvasFullscreen ? '⛶ Выйти' : '⛶ Развернуть'}
            </button>

            <div style={styles.spacer} />
            {msg ? <span style={styles.msgOk}>{msg}</span> : null}
            {err ? <span style={styles.msgErr}>{err}</span> : null}
          </div>
        ) : null}

        {/* ─── Три колонки ────────────────────────────────────────── */}
        {!selectedPanelId ? (
          <Card title="Панель не выбрана">
            <p style={styles.muted}>
              Выберите панель из списка или создайте новую.
            </p>
          </Card>
        ) : (
          <div
            style={canvasFullscreen ? styles.threeColFull : styles.threeCol}
          >
            {/* ─── Palette ──────────────────────────────────────── */}
            <aside style={styles.palette}>
              <div style={styles.colHeader}>Библиотека виджетов</div>
              <input
                style={styles.input}
                placeholder="Фильтр…"
                value={paletteFilter}
                onChange={(e) => setPaletteFilter(e.target.value)}
              />
              <div style={styles.paletteList}>
                {filteredPalette.length === 0 ? (
                  <div style={styles.muted}>Ничего не найдено</div>
                ) : (
                  filteredPalette.map((w) => (
                    <div
                      key={w.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'application/x-xartia-widget',
                          w.id,
                        );
                        e.dataTransfer.setData('text/plain', w.id);
                        e.dataTransfer.effectAllowed = 'copy';
                        console.warn('[Palette dragstart]', {
                          widgetId: w.id,
                          types: Array.from(e.dataTransfer.types),
                        });
                      }}
                      style={styles.paletteItem}
                      title="Перетащите на холст или кликните «+»"
                    >
                      <div style={styles.paletteRow}>
                        <div style={styles.paletteText}>
                          <div style={styles.paletteTitle}>
                            {w.type === 'container' ? '📦 ' : ''}
                            {w.type}
                          </div>
                          <div style={styles.paletteSub}>{w.entity}</div>
                        </div>
                        <button
                          type="button"
                          style={styles.paletteAdd}
                          onClick={() => addWidgetAtEnd(w.id)}
                          title="Добавить в конец холста"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* ─── Canvas ───────────────────────────────────────── */}
            <PanelCanvas
              instances={instances}
              widgets={widgetById}
              context={previewContext}
              screenSize={screenSize}
              zoom={zoom}
              sizePresets={SIZE_PRESETS}
              defaultSize={DEFAULT_SIZE}
              loading={instancesQ.isLoading}
              interactive={canEdit}
              selectedInstanceId={selectedInstanceId}
              onSelectInstance={setSelectedInstanceId}
              onRemoveInstance={(id) => deleteWidgetM.mutate(id)}
              onLayoutCommit={persistLayoutItem}
              onDropWidget={onDrop}
              droppingItem={droppingItem}
            />

            {/* ─── Properties ───────────────────────────────────── */}
              {!canvasFullscreen ? (
                <aside style={styles.properties}>
                  <div style={styles.colHeader}>Свойства виджета</div>
                  {!selectedInstance ? (
                    <div style={styles.muted}>
                      Кликните по виджету, чтобы отредактировать его.
                    </div>
                  ) : (() => {
                    const w = widgetById.get(selectedInstance.widgetId);
                    if (!w) {
                      return (
                        <div style={styles.muted}>
                          Виджет не найден в библиотеке.
                        </div>
                      );
                    }
                    const isSelectedContainer = w.type === 'container';
                    const containers = instances.filter((inst) => {
                      const wi = widgetById.get(inst.widgetId);
                      return wi?.type === 'container';
                    });

                    return (
                      <>
                        <div style={styles.field}>
                          <label style={styles.fieldLabel}>Размер</label>
                          <div style={styles.sizeRow}>
                            {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((p) => (
                              <button
                                key={p}
                                type="button"
                                style={styles.sizeBtn}
                                disabled={!canEdit || updateWidgetM.isPending}
                                onClick={() => setWidgetSize(selectedInstance.id, p)}
                                title={SIZE_PRESETS[p].label}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>

                        {!isSelectedContainer ? (
                          <div style={styles.field}>
                            <label style={styles.fieldLabel}>Контейнер</label>
                            <select
                              style={styles.input}
                              value={selectedInstance.parentId ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateWidgetM.mutate({
                                  instanceId: selectedInstance.id,
                                  parentId: val === '' ? null : val,
                                  position: { x: 0, y: 0 },
                                });
                              }}
                              disabled={!canEdit || updateWidgetM.isPending}
                            >
                              <option value="">— Корень панели —</option>
                              {containers
                                .filter((c) => c.id !== selectedInstance.id)
                                .map((c) => {
                                  const cw = widgetById.get(c.widgetId);
                                  const cfgTitle = cw?.config?.['title'];
                                  const title =
                                    typeof cfgTitle === 'string'
                                      ? cfgTitle
                                      : `Контейнер ${c.id.slice(0, 6)}`;
                                  return (
                                    <option key={c.id} value={c.id}>
                                      {title}
                                    </option>
                                  );
                                })}
                            </select>
                            <span style={styles.fieldHint}>
                              {selectedInstance.parentId
                                ? 'Виджет внутри контейнера. Смените, чтобы вынести на корень панели.'
                                : 'Виджет на корне панели. Выберите контейнер, чтобы вложить.'}
                            </span>
                          </div>
                        ) : (
                          <div style={styles.field}>
                            <span style={styles.fieldHint}>
                              Контейнер. Перетащите в него виджеты из палитры или
                              переместите существующие через их свойства.
                            </span>
                          </div>
                        )}

                        <div style={styles.divider} />

                        <WidgetProperties
                          instance={selectedInstance}
                          widget={w}
                          canEdit={canEdit}
                          busy={updateWidgetM.isPending}
                          onSave={(overrides) => {
                            updateWidgetM.mutate({
                              instanceId: selectedInstance.id,
                              overrides,
                            });
                            setMsg('Настройки сохранены');
                          }}
                        />
                      </>
                    );
                  })()}
                </aside>
              ) : null}  
          </div>
        )}

        {/* ─── Модалки ────────────────────────────────────────────── */}
        {creatingPanel ? (
          <PanelForm
            mode="create"
            directions={directionsQ.data?.data ?? []}
            roles={rolesQ.data?.data ?? []}
            busy={createPanelM.isPending}
            error={
              createPanelM.isError
                ? (createPanelM.error as ApiError).message
                : null
            }
            onCancel={() => setCreatingPanel(false)}
            onSubmit={(input) => createPanelM.mutate(input)}
          />
        ) : null}

        {editingPanel && currentPanel ? (
          <PanelForm
            mode="edit"
            initial={currentPanel}
            directions={directionsQ.data?.data ?? []}
            roles={rolesQ.data?.data ?? []}
            busy={updatePanelM.isPending}
            error={
              updatePanelM.isError
                ? (updatePanelM.error as ApiError).message
                : null
            }
            onCancel={() => setEditingPanel(false)}
            onSubmit={(input) =>
              updatePanelM.mutate({ panelId: currentPanel.id, ...input })
            }
          />
        ) : null}

        {showVersions && selectedPanelId ? (
          <VersionsModal
            versions={versionsQ.data?.data ?? []}
            loading={versionsQ.isLoading}
            onClose={() => setShowVersions(false)}
            onRollback={(version) => rollbackM.mutate(version)}
            busy={rollbackM.isPending}
          />
        ) : null}

        {showPreview && currentPanel ? (
          <PanelPreview
            panel={currentPanel}
            instances={instances}
            widgets={widgetById}
            onClose={() => setShowPreview(false)}
          />
        ) : null}
      </div>
    </DndProvider>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md, height: '100%' },
  header: { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: spacing.md, flexWrap: 'wrap' as const },
  headerLeft: { display: 'flex' as const, flexDirection: 'column' as const, gap: 4 },
  headerActions: { display: 'flex' as const, gap: spacing.sm, alignItems: 'center' as const, flexWrap: 'wrap' as const },
  panelMeta: { display: 'flex' as const, gap: spacing.sm, alignItems: 'center' as const, flexWrap: 'wrap' as const },
  h1: { margin: 0, fontSize: fontSize.xxl, color: colors.text },
  panelSelect: { background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radius.md, color: colors.text, padding: '8px 12px', fontSize: fontSize.sm, fontFamily: 'inherit' },
  toolbar: { display: 'flex' as const, gap: spacing.sm, alignItems: 'center' as const, padding: `${spacing.sm}px 0`, borderTop: `1px solid ${colors.borderSoft}`, borderBottom: `1px solid ${colors.borderSoft}`, flexWrap: 'wrap' as const },
  toolbarLabel: { color: colors.textMuted, fontSize: fontSize.xs, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  ctxBtn: { background: 'transparent', borderWidth: 1, borderStyle: 'solid' as const, borderColor: colors.border, borderRadius: radius.sm, color: colors.text, padding: '4px 10px', cursor: 'pointer' as const, fontSize: fontSize.xs },
  ctxBtnActive: { background: colors.primary, borderColor: colors.primary, color: '#fff' },
  spacer: { flex: 1 },
  msgOk: { color: colors.success, fontSize: fontSize.xs },
  msgErr: { color: colors.danger, fontSize: fontSize.xs },
  threeCol: { display: 'grid' as const, gridTemplateColumns: '260px 1fr 340px', gap: spacing.md, flex: 1, minHeight: 0 },
  palette: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.sm, background: colors.bgSoft, border: `1px solid ${colors.borderSoft}`, borderRadius: radius.lg, padding: spacing.md, overflow: 'hidden' as const, minHeight: 0 },
  paletteList: { display: 'flex' as const, flexDirection: 'column' as const, gap: 6, overflowY: 'auto' as const, flex: 1, minHeight: 0 },
  paletteItem: { background: colors.bg, border: `1px solid ${colors.borderSoft}`, borderRadius: radius.md, padding: '8px 10px', cursor: 'grab' as const, userSelect: 'none' as const },
  paletteRow: { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: spacing.sm },
  paletteText: { flex: 1, minWidth: 0 },
  paletteTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: 600 },
  paletteSub: { color: colors.textMuted, fontSize: fontSize.xs },
  paletteAdd: { background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: radius.sm, color: colors.text, width: 24, height: 24, cursor: 'pointer' as const, fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 },
  colHeader: { color: colors.textMuted, fontSize: fontSize.xs, textTransform: 'uppercase' as const, letterSpacing: 0.6, fontWeight: 600 },
  previewToolbar: { display: 'flex' as const, gap: spacing.sm, alignItems: 'center' as const, padding: `${spacing.sm}px 0`, borderBottom: `1px solid ${colors.borderSoft}`, flexWrap: 'wrap' as const },
  previewViewport: { display: 'flex' as const, flexDirection: 'column' as const, flex: 1, minHeight: 0, marginTop: spacing.sm },
  properties: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.sm, background: colors.bgSoft, border: `1px solid ${colors.borderSoft}`, borderRadius: radius.lg, padding: spacing.md, overflowY: 'auto' as const, minHeight: 0 },
  propsBody: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.sm },
  propRow: { display: 'flex' as const, justifyContent: 'space-between' as const, gap: spacing.sm, fontSize: fontSize.sm },
  propLabel: { color: colors.textMuted, fontSize: fontSize.xs, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  propValue: { color: colors.text, fontSize: fontSize.sm },
  propValueMono: { color: colors.text, fontFamily: 'monospace', fontSize: fontSize.xs },
  propsActions: { display: 'flex' as const, gap: spacing.sm, paddingTop: spacing.sm, borderTop: `1px solid ${colors.borderSoft}` },
  divider: { borderTop: `1px solid ${colors.borderSoft}`, margin: `${spacing.sm}px 0` },
  field: { display: 'flex' as const, flexDirection: 'column' as const, gap: 4 },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  fieldHint: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 2 },
  required: { color: colors.danger },
  input: { background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radius.md, color: colors.text, padding: '8px 12px', fontSize: fontSize.sm, fontFamily: 'inherit', outline: 'none' as const, width: '100%', boxSizing: 'border-box' as const },
  jsonEditor: { background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radius.md, color: colors.text, padding: '8px 12px', fontSize: fontSize.xs, fontFamily: 'monospace', resize: 'vertical' as const, width: '100%', boxSizing: 'border-box' as const, marginTop: 4 },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  errorBlock: { color: colors.danger, fontSize: fontSize.sm, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: radius.sm, padding: spacing.sm },
  modalBackdrop: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 1000 },
  modal: { background: colors.bgSoft, border: `1px solid ${colors.border}`, borderRadius: radius.lg, minWidth: 520, maxWidth: 700, maxHeight: '85vh', display: 'flex' as const, flexDirection: 'column' as const },
  modalFullscreen: { minWidth: '90vw', maxWidth: '95vw', height: '90vh' },
  modalHeader: { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, padding: spacing.md, borderBottom: `1px solid ${colors.borderSoft}` },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: 600 },
  modalClose: { background: 'transparent', border: 'none', color: colors.textMuted, fontSize: 20, cursor: 'pointer' as const, lineHeight: 1 },
  modalBody: { padding: spacing.md, display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md, overflowY: 'auto' as const, flex: 1, minHeight: 0 },
  modalActions: { display: 'flex' as const, justifyContent: 'flex-end' as const, gap: spacing.sm, paddingTop: spacing.sm, borderTop: `1px solid ${colors.borderSoft}` },
  versionList: { display: 'flex' as const, flexDirection: 'column' as const, gap: 6 },
  versionRow: { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, padding: '8px 10px', background: colors.bg, border: `1px solid ${colors.borderSoft}`, borderRadius: radius.md },
  versionNumber: { color: colors.text, fontWeight: 600, fontSize: fontSize.sm },
  kvList: { display: 'flex' as const, flexDirection: 'column' as const, gap: 4 },
  kvRow: { display: 'flex' as const, gap: 4, alignItems: 'center' as const },
  kvKey: { flex: '0 0 40%', background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radius.sm, color: colors.text, padding: '6px 8px', fontSize: fontSize.xs, fontFamily: 'monospace' },
  kvValue: { flex: 1, background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radius.sm, color: colors.text, padding: '6px 8px', fontSize: fontSize.xs, fontFamily: 'monospace' },
  kvRemove: { background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: radius.sm, color: colors.textMuted, width: 24, height: 24, cursor: 'pointer' as const, fontSize: 14, lineHeight: 1, padding: 0 },
  addRowBtn: { background: 'transparent', border: `1px dashed ${colors.border}`, borderRadius: radius.sm, color: colors.textMuted, padding: '6px 10px', fontSize: fontSize.xs, cursor: 'pointer' as const },
  advancedToggle: { background: 'transparent', border: 'none', color: colors.textMuted, fontSize: fontSize.xs, cursor: 'pointer' as const, padding: 0, textAlign: 'left' as const },
  sizeRow: { display: 'flex' as const, gap: 4 },
  sizeBtn: { flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: radius.sm, color: colors.text, padding: '6px 8px', fontSize: fontSize.xs, cursor: 'pointer' as const, fontWeight: 600 },
  visibilityBadge: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: '2px 10px',
    borderRadius: radius.full,
    border: '1px solid',
    fontSize: fontSize.xs,
  },
  visibilityBadgeOk: {
    background: 'rgba(16,185,129,0.10)',
    borderColor: 'rgba(16,185,129,0.30)',
    color: colors.success,
  },
  visibilityBadgeWarn: {
    background: 'rgba(245,158,11,0.10)',
    borderColor: 'rgba(245,158,11,0.30)',
    color: colors.warning,
  },
  visibilityHint: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    border: '1px solid',
    fontSize: fontSize.sm,
  },
  visibilityHintOk: {
    background: 'rgba(16,185,129,0.06)',
    borderColor: 'rgba(16,185,129,0.25)',
    color: colors.success,
  },
  visibilityHintWarn: {
    background: 'rgba(245,158,11,0.06)',
    borderColor: 'rgba(245,158,11,0.25)',
    color: colors.warning,
  },
  threeColFull: {
    display: 'grid' as const,
    gridTemplateColumns: '260px 1fr',
    gap: spacing.md,
    flex: 1,
    minHeight: 0,
  },
} as const;