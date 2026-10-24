// src/web/pages/Goods.tsx
/**
 * F.4.02.07 — Goods page.
 *
 * Список благ + создание + детальная панель с actions.
 * Project resources (тройная подпись) — отдельная итерация.
 * URL-sync: ?selected=<id> открывает деталь (из CommandPalette).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  Form,
  FormInput,
  FormSelect,
  FormTextarea,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type GoodStatus = 'draft' | 'test' | 'active' | 'obsolete' | 'liquidated';
type GoodType = 'material' | 'nonmaterial';

interface Good {
  id: string;
  name: string;
  type: GoodType;
  status: GoodStatus;
  producerDirectionId: string;
  description: string | null;
  version: number;
  components: Array<{ part: string; description: string }>;
  authorIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface GoodHistoryEntry {
  version: number;
  changes: Record<string, unknown>;
  authorId: string;
  createdAt: string;
}

interface ListResponse {
  data: Good[];
  meta: { page: number; per_page: number; total: number };
}

// ─── Константы ───────────────────────────────────────────────────

const STATUS_LABEL: Record<GoodStatus, string> = {
  draft: 'Черновик',
  test: 'Тестирование',
  active: 'Активно',
  obsolete: 'Устарело',
  liquidated: 'Ликвидировано',
};

const STATUS_TONE: Record<GoodStatus, BadgeTone> = {
  draft: 'default',
  test: 'warning',
  active: 'success',
  obsolete: 'info',
  liquidated: 'danger',
};

const TYPE_LABEL: Record<GoodType, string> = {
  material: 'Материальное',
  nonmaterial: 'Нематериальное',
};

const createSchema = z.object({
  name: z.string().min(1, 'Укажите название').max(255),
  type: z.enum(['material', 'nonmaterial'], {
    message: 'Выберите тип',
  }),
  description: z.string().max(5000).optional(),
});

type CreateGood = z.infer<typeof createSchema>;

// ─── Страница ────────────────────────────────────────────────────

export function GoodsPage(): ReactElement {
  const user = useUser();
  const [filterStatus, setFilterStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const selectedFromUrl = searchParams.get('selected');

  useEffect(() => {
    if (selectedFromUrl && selectedFromUrl !== selectedId) {
      setSelectedId(selectedFromUrl);
    }
  }, [selectedFromUrl, selectedId]);

  const producerDirectionId = user?.participant.directionId ?? '';

  const listQuery = useApiQuery<ListResponse>(
    ['goods', 'list', filterStatus],
    `/goods?page=1&per_page=100${filterStatus ? `&status=${filterStatus}` : ''}`,
  );

  const rows = listQuery.data?.data ?? [];

  const columns: Column<Good>[] = useMemo(
    () => [
      {
        key: 'name',
        title: 'Название',
        sortable: true,
      },
      {
        key: 'type',
        title: 'Тип',
        width: 160,
        render: (r) => TYPE_LABEL[r.type] ?? r.type,
      },
      {
        key: 'status',
        title: 'Статус',
        width: 130,
        render: (r) => (
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        ),
      },
      {
        key: 'version',
        title: 'Версия',
        width: 80,
        align: 'center',
        sortable: true,
      },
      {
        key: 'components',
        title: 'Компонентов',
        width: 130,
        align: 'center',
        render: (r) => String(r.components?.length ?? 0),
      },
    ],
    [],
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Блага</h1>
        <div style={styles.headerActions}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(STATUS_LABEL) as GoodStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать
          </Button>
        </div>
      </div>

      {listQuery.isLoading ? (
        <Spinner label="Загружаем блага…" />
      ) : listQuery.isError ? (
        <Card title="Ошибка">
          <p style={styles.muted}>Не удалось загрузить список благ</p>
        </Card>
      ) : (
        <Table<Good>
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          emptyMessage="Нет благ"
        />
      )}

      {creating ? (
        <CreateGoodModal
          producerDirectionId={producerDirectionId}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {selectedId ? (
        <GoodDetailPanel
          goodId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Модалка создания ────────────────────────────────────────────

function CreateGoodModal({
  producerDirectionId,
  onClose,
}: {
  producerDirectionId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CreateGood) =>
      apiPost<Good>('/goods', {
        name: data.name,
        type: data.type,
        producer_direction_id: producerDirectionId,
        description: data.description ?? null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goods'] });
      onClose();
    },
    onError: (e) => {
      setServerError((e as Error).message || 'Не удалось создать благо');
    },
  });

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Новое благо">
          <Form<CreateGood>
            schema={createSchema}
            defaultValues={{ name: '', type: 'material', description: '' }}
            submitLabel="Создать"
            onCancel={onClose}
            loading={createM.isPending}
            onSubmit={async (data) => {
              setServerError(null);
              await createM.mutateAsync(data);
            }}
          >
            <FormInput
              name="name"
              label="Название"
              placeholder="Например: Стальной лист 10м²"
              required
            />
            <FormSelect
              name="type"
              label="Тип"
              required
              options={[
                { value: 'material', label: 'Материальное' },
                { value: 'nonmaterial', label: 'Нематериальное' },
              ]}
            />
            <FormTextarea
              name="description"
              label="Описание"
              rows={3}
              maxLength={5000}
            />
            {serverError ? (
              <div style={styles.error}>{serverError}</div>
            ) : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Панель деталей ──────────────────────────────────────────────

function GoodDetailPanel({
  goodId,
  onClose,
}: {
  goodId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [componentPart, setComponentPart] = useState('');
  const [componentDesc, setComponentDesc] = useState('');
  const [liquidateReason, setLiquidateReason] = useState('');
  const [liquidateVerifier, setLiquidateVerifier] = useState('');

  const goodQuery = useApiQuery<Good>(
    ['goods', 'detail', goodId],
    `/goods/${goodId}`,
  );

  const historyQuery = useApiQuery<{ data: GoodHistoryEntry[] }>(
    ['goods', 'history', goodId],
    `/goods/${goodId}/history`,
  );

  const actionM = useMutation({
    mutationFn: async (vars: {
      action: 'test' | 'approve' | 'liquidate';
      body?: Record<string, unknown>;
    }) => {
      const path = `/goods/${goodId}/${vars.action}`;
      return apiPost<Good>(path, vars.body ?? {});
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goods'] });
      setServerError(null);
    },
    onError: (e) => {
      setServerError((e as Error).message || 'Действие не удалось');
    },
  });

  const addComponent = async (): Promise<void> => {
    if (!componentPart.trim() || !componentDesc.trim()) {
      setServerError('Заполните часть и описание компонента');
      return;
    }
    try {
      await apiPost(`/goods/${goodId}/component`, {
        part: componentPart.trim(),
        description: componentDesc.trim(),
      });
      setComponentPart('');
      setComponentDesc('');
      setServerError(null);
      void qc.invalidateQueries({ queryKey: ['goods', 'detail', goodId] });
    } catch (e) {
      setServerError((e as Error).message || 'Не удалось добавить компонент');
    }
  };

  if (goodQuery.isLoading) {
    return (
      <SidePanel onClose={onClose}>
        <Spinner label="Загружаем благо…" />
      </SidePanel>
    );
  }
  if (goodQuery.isError || !goodQuery.data) {
    return (
      <SidePanel onClose={onClose}>
        <p style={styles.muted}>Не удалось загрузить благо</p>
      </SidePanel>
    );
  }

  const g = goodQuery.data;
  const history = historyQuery.data?.data ?? [];

  return (
    <SidePanel onClose={onClose}>
      <div style={styles.detailHeader}>
        <h2 style={styles.detailTitle}>{g.name}</h2>
        <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge>
      </div>
      <div style={styles.detailMeta}>
        <span>Тип: {TYPE_LABEL[g.type] ?? g.type}</span>
        <span>Версия: {g.version}</span>
      </div>
      {g.description ? (
        <p style={styles.detailDesc}>{g.description}</p>
      ) : null}

      {serverError ? <div style={styles.error}>{serverError}</div> : null}

      {/* Actions */}
      <div style={styles.actionsRow}>
        {g.status === 'draft' ? (
          <Button
            variant="primary"
            disabled={actionM.isPending}
            onClick={() => void actionM.mutateAsync({ action: 'test' })}
          >
            Отправить на тест
          </Button>
        ) : null}
        {g.status === 'test' ? (
          <Button
            variant="primary"
            disabled={actionM.isPending}
            onClick={() => void actionM.mutateAsync({ action: 'approve' })}
          >
            Утвердить
          </Button>
        ) : null}
        {g.status !== 'liquidated' ? (
          <Button
            variant="danger"
            disabled={actionM.isPending}
            onClick={() => {
              const reason = liquidateReason.trim();
              const verifier = liquidateVerifier.trim();

              if (!reason) {
                setServerError('Укажите причину ликвидации');
                return;
              }
              if (!verifier) {
                setServerError('Укажите UUID верификатора');
                return;
              }
              if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verifier)) {
                setServerError('UUID верификатора имеет неверный формат');
                return;
              }

              void actionM.mutateAsync({
                action: 'liquidate',
                body: { reason, verifier_id: verifier },
              });
            }}
          >
            Ликвидировать
          </Button>
        ) : null}
      </div>

      {/* Liquidate form */}
      {g.status !== 'liquidated' ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Ликвидация</div>
          <input
            style={styles.input}
            placeholder="Причина"
            value={liquidateReason}
            onChange={(e) => setLiquidateReason(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="UUID верификатора"
            value={liquidateVerifier}
            onChange={(e) => setLiquidateVerifier(e.target.value)}
          />
        </div>
      ) : null}

      {/* Components */}
      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>
          Компоненты ({g.components?.length ?? 0})
        </div>
        {(g.components ?? []).length === 0 ? (
          <p style={styles.muted}>Нет компонентов</p>
        ) : (
          (g.components ?? []).map((c, i) => (
            <div key={i} style={styles.componentRow}>
              <strong style={styles.componentPart}>{c.part}</strong>
              <span style={styles.componentDesc}>{c.description}</span>
            </div>
          ))
        )}
        {g.status !== 'liquidated' ? (
          <div style={styles.addComponentBlock}>
            <input
              style={styles.input}
              placeholder="Часть (например, «Корпус»)"
              value={componentPart}
              onChange={(e) => setComponentPart(e.target.value)}
            />
            <input
              style={styles.input}
              placeholder="Описание компонента"
              value={componentDesc}
              onChange={(e) => setComponentDesc(e.target.value)}
            />
            <Button variant="secondary" onClick={() => void addComponent()}>
              + Добавить компонент
            </Button>
          </div>
        ) : null}
      </div>

      {/* History */}
      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>
          История ({history.length})
        </div>
        {history.length === 0 ? (
          <p style={styles.muted}>История пуста</p>
        ) : (
          history.slice(0, 10).map((h, i) => (
            <div key={i} style={styles.historyRow}>
              <span style={styles.historyVersion}>v{h.version}</span>
              <span style={styles.historyDate}>
                {new Date(h.createdAt).toLocaleString('ru-RU')}
              </span>
            </div>
          ))
        )}
      </div>
    </SidePanel>
  );
}

// ─── SidePanel (правая панель) ───────────────────────────────────

function SidePanel({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): ReactElement {
  return (
    <div style={styles.sideBackdrop} onClick={onClose}>
      <div style={styles.sidePanel} onClick={(e) => e.stopPropagation()}>
        <button type="button" style={styles.sideClose} onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
  },
  title: { margin: 0, fontSize: 22, color: colors.text },
  headerActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  modalBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 480,
  },
  sideBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    zIndex: 100,
  },
  sidePanel: {
    width: 480,
    maxWidth: '100vw',
    height: '100vh',
    background: colors.bgSoft,
    borderLeft: `1px solid ${colors.border}`,
    padding: spacing.lg,
    overflowY: 'auto' as const,
    position: 'relative' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  sideClose: {
    position: 'absolute' as const,
    top: spacing.sm,
    right: spacing.sm,
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    fontSize: 24,
    cursor: 'pointer',
    lineHeight: 1,
  },
  detailHeader: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    paddingRight: 30,
  },
  detailTitle: {
    margin: 0,
    fontSize: 20,
    color: colors.text,
    flex: 1,
  },
  detailMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  detailDesc: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
    margin: 0,
  },
  actionsRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  subBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  componentRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  componentPart: {
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 90,
  },
  componentDesc: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    flex: 1,
  },
  addComponentBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  historyRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  historyVersion: {
    color: colors.text,
    fontWeight: 500,
  },
  historyDate: {
    color: colors.textMuted,
  },
};