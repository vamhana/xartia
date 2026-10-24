// src/web/pages/Quanta.tsx
/**
 * F.4.02.17 — Панель Quanta.
 *
 * 3 таба: Каталог / Обязательные / Обнаружение.
 * Master-detail в «Каталоге» по образцу Signals.tsx.
 * Жизненный цикл: detected → audit → testing → scaling → active → cancelled.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Form, FormInput, FormTextarea, FormSelect } from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type Tab = 'catalog' | 'mandatory' | 'detect';

type QuantumStatus =
  | 'detected' | 'audit' | 'testing' | 'scaling' | 'active' | 'cancelled';

type QuantumTestResult = 'success' | 'failure';

interface Quantum {
  id: string;
  level: number;
  type: string;
  sourceCellId: string;
  description: string;
  areaOfApplicability: Record<string, unknown>;
  limitations: Record<string, unknown>;
  successCriteria: Record<string, unknown>;
  stopCriteria: Record<string, unknown>;
  status: QuantumStatus;
  mandatory: boolean;
  createdAt: string;
  updatedAt: string;
}

interface QuantumTest {
  id: string;
  quantumId: string;
  cellId: string;
  result: QuantumTestResult;
  notes: string | null;
  createdAt: string;
}

interface DetectCandidate {
  cellId: string;
  advantage: number;
}

// ─── Константы ───────────────────────────────────────────────────

const TAB_LABEL: Record<Tab, string> = {
  catalog: 'Каталог',
  mandatory: 'Обязательные',
  detect: 'Обнаружение',
};

const STATUS_LABEL: Record<QuantumStatus, string> = {
  detected: 'Обнаружен',
  audit: 'Аудит',
  testing: 'Тестирование',
  scaling: 'Масштабирование',
  active: 'Активен',
  cancelled: 'Отменён',
};

const STATUS_TONE: Record<QuantumStatus, BadgeTone> = {
  detected: 'info',
  audit: 'warning',
  testing: 'warning',
  scaling: 'high',
  active: 'success',
  cancelled: 'default',
};

const LEVEL_LABEL: Record<number, string> = {
  1: 'L1 — базовый',
  2: 'L2 — локальный',
  3: 'L3 — направленческий',
  4: 'L4 — межнаправленческий',
  5: 'L5 — общинный',
  6: 'L6 — планетарный',
};

// ─── Схемы ───────────────────────────────────────────────────────

const createSchema = z.object({
  level: z.coerce.number().int().min(1).max(6),
  type: z.string().min(1, 'Тип обязателен').max(128),
  source_cell_id: z.string().uuid('UUID ячейки'),
  description: z.string().min(1, 'Описание обязательно').max(10000),
  mandatory: z.boolean().default(false),
});

const stopSchema = z.object({
  reason: z.string().min(1, 'Причина обязательна').max(2000),
});

const testSchema = z.object({
  cell_ids_text: z.string().min(1, 'Укажите 3–5 UUID через запятую'),
});

const testRecordSchema = z.object({
  cell_id: z.string().uuid('UUID ячейки'),
  result: z.enum(['success', 'failure']),
  notes: z.string().max(5000).optional(),
});

const applySchema = z.object({
  community_id: z.string().uuid('UUID общины'),
});

// ─── Страница ────────────────────────────────────────────────────

export function QuantaPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('catalog');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Кванты</h1>
        <span style={styles.subtitle}>
          Минимальные автономные единицы развития (IV.3)
        </span>
      </div>

      <div style={styles.tabs}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'catalog' && <CatalogTab />}
      {tab === 'mandatory' && <MandatoryTab />}
      {tab === 'detect' && <DetectTab />}
    </div>
  );
}

// ─── Каталог (master-detail) ────────────────────────────────────

function CatalogTab(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLevel, setFilterLevel] = useState('');

  const q = useApiQuery<{ data: Quantum[] }>(
    ['quanta', 'list', filterStatus, filterLevel],
    `/quanta?page=1&per_page=100${filterStatus ? `&status=${filterStatus}` : ''}${filterLevel ? `&level=${filterLevel}` : ''}`,
  );

  const quanta = q.data?.data ?? [];

  return (
    <div style={styles.split}>
      <aside style={styles.list}>
        <div style={styles.filters}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(STATUS_LABEL) as QuantumStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            style={styles.select}
          >
            <option value="">Все уровни</option>
            {[1, 2, 3, 4, 5, 6].map((l) => (
              <option key={l} value={l}>L{l}</option>
            ))}
          </select>
          {rights.hasRight('quantum', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Обнаружить
            </Button>
          ) : null}
        </div>

        {q.isLoading ? (
          <Spinner />
        ) : quanta.length === 0 ? (
          <div style={styles.empty}>Квантов нет</div>
        ) : (
          quanta.map((quantum) => (
            <button
              key={quantum.id}
              type="button"
              onClick={() => setSelectedId(quantum.id)}
              style={{
                ...styles.listItem,
                ...(quantum.id === selectedId ? styles.listItemActive : {}),
              }}
            >
              <div style={styles.listItemTop}>
                <Badge tone="info">L{quantum.level}</Badge>
                <Badge tone={STATUS_TONE[quantum.status]}>
                  {STATUS_LABEL[quantum.status]}
                </Badge>
                {quantum.mandatory ? <Badge tone="high">M</Badge> : null}
              </div>
              <div style={styles.listItemDesc}>{quantum.description}</div>
              <div style={styles.listItemMeta}>
                <span style={styles.mono}>{quantum.type}</span>
                <span style={styles.dim}>
                  {new Date(quantum.createdAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            </button>
          ))
        )}
      </aside>

      <section style={styles.detail}>
        {creating ? (
          <CreateQuantumForm
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setSelectedId(id);
              void qc.invalidateQueries({ queryKey: ['quanta'] });
            }}
          />
        ) : selectedId ? (
          <QuantumDetail
            quantumId={selectedId}
            onChange={() => void qc.invalidateQueries({ queryKey: ['quanta'] })}
          />
        ) : (
          <Card>
            <div style={styles.empty}>Выберите квант слева или создайте новый</div>
          </Card>
        )}
      </section>
    </div>
  );
}

// ─── Детали кванта ──────────────────────────────────────────────

export function QuantumDetail({
  quantumId,
  onChange,
}: {
  quantumId: string;
  onChange?: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [stopping, setStopping] = useState(false);
  const [applying, setApplying] = useState(false);

  const detailQ = useApiQuery<Quantum>(
    ['quanta', 'detail', quantumId],
    `/quanta/${quantumId}`,
  );
  const readinessQ = useApiQuery<{ allowed: boolean; reason?: string }>(
    ['quanta', 'readiness', quantumId],
    `/quanta/${quantumId}/readiness`,
    { enabled: false }, // ручка не зарегистрирована — оставим как заглушку
  );

  const auditM = useMutation({
    mutationFn: () => apiPost(`/quanta/${quantumId}/audit`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quanta'] });
      onChange?.();
    },
  });

  const scaleM = useMutation({
    mutationFn: () => apiPost(`/quanta/${quantumId}/scale`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quanta'] });
      onChange?.();
    },
  });

  const documentM = useMutation({
    mutationFn: () => apiPost<{ documented: boolean }>(`/quanta/${quantumId}/document`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quanta'] }),
  });

  const quantum = detailQ.data;

  if (detailQ.isLoading) {return <Spinner />;}
  if (!quantum) {return <Card><div style={styles.empty}>Квант не найден</div></Card>;}

  void readinessQ;

  return (
    <>
      <Card
        title={
          <div style={styles.detailHeader}>
            <Badge tone="info">L{quantum.level}</Badge>
            <Badge tone={STATUS_TONE[quantum.status]}>
              {STATUS_LABEL[quantum.status]}
            </Badge>
            {quantum.mandatory ? <Badge tone="high">Обязательный</Badge> : null}
          </div>
        }
        subtitle={`${quantum.type} · ${new Date(quantum.createdAt).toLocaleString('ru-RU')}`}
      >
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Описание</div>
          <div style={styles.fieldText}>{quantum.description}</div>
        </div>

        <div style={styles.criteriaGrid}>
          <CriteriaBlock label="Область применимости" data={quantum.areaOfApplicability} />
          <CriteriaBlock label="Ограничения" data={quantum.limitations} />
          <CriteriaBlock label="Критерии успеха" data={quantum.successCriteria} />
          <CriteriaBlock label="Критерии остановки" data={quantum.stopCriteria} />
        </div>

        <div style={styles.actions}>
          {quantum.status === 'detected' && rights.hasRight('quantum', 'A') ? (
            <Button
              variant="primary"
              onClick={() => void auditM.mutateAsync()}
              disabled={auditM.isPending}
            >
              {auditM.isPending ? '…' : 'Аудит'}
            </Button>
          ) : null}
          {quantum.status === 'testing' && rights.hasRight('quantum', 'A') ? (
            <Button
              variant="primary"
              onClick={() => void scaleM.mutateAsync()}
              disabled={scaleM.isPending}
            >
              {scaleM.isPending ? '…' : 'Масштабировать'}
            </Button>
          ) : null}
          {rights.hasRight('quantum', 'E') ? (
            <Button
              variant="secondary"
              onClick={() => void documentM.mutateAsync()}
              disabled={documentM.isPending}
            >
              {documentM.isPending ? '…' : 'Документировать'}
            </Button>
          ) : null}
          {quantum.status === 'scaling' && rights.hasRight('quantum', 'E') ? (
            <Button variant="secondary" onClick={() => setApplying(true)}>
              Внедрить в общину
            </Button>
          ) : null}
          {quantum.status !== 'cancelled' && rights.hasRight('quantum', 'A') ? (
            <Button variant="danger" onClick={() => setStopping(true)}>
              Остановить
            </Button>
          ) : null}
          {documentM.data?.documented ? (
            <Badge tone="success">Задокументирован</Badge>
          ) : null}
        </div>
      </Card>

      {quantum.status === 'testing' || quantum.status === 'scaling' ? (
        <QuantumTestPanel quantumId={quantumId} />
      ) : null}

      {stopping ? (
        <Modal onClose={() => setStopping(false)} title="Остановить квант">
          <Form<z.infer<typeof stopSchema>>
            schema={stopSchema}
            defaultValues={{ reason: '' }}
            submitLabel="Остановить"
            onCancel={() => setStopping(false)}
            onSubmit={async (data) => {
              await apiPost(`/quanta/${quantumId}/stop`, data);
              void qc.invalidateQueries({ queryKey: ['quanta'] });
              setStopping(false);
              onChange?.();
            }}
          >
            <FormTextarea name="reason" label="Причина" rows={3} required />
          </Form>
        </Modal>
      ) : null}

      {applying ? (
        <Modal onClose={() => setApplying(false)} title="Внедрить в общину">
          <Form<z.infer<typeof applySchema>>
            schema={applySchema}
            defaultValues={{ community_id: '' }}
            submitLabel="Внедрить"
            onCancel={() => setApplying(false)}
            onSubmit={async (data) => {
              await apiPost(`/quanta/${quantumId}/apply`, data);
              void qc.invalidateQueries({ queryKey: ['quanta'] });
              setApplying(false);
            }}
          >
            <FormInput name="community_id" label="UUID общины" required />
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

function CriteriaBlock({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown>;
}): ReactElement {
  const isEmpty = !data || Object.keys(data).length === 0;
  return (
    <div style={styles.criteriaBlock}>
      <div style={styles.fieldLabel}>{label}</div>
      {isEmpty ? (
        <div style={styles.dim}>—</div>
      ) : (
        <pre style={styles.json}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

// ─── Панель тестов ──────────────────────────────────────────────

export function QuantumTestPanel({
  quantumId,
}: {
  quantumId: string;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [testForm, setTestForm] = useState(false);
  const [recordForm, setRecordForm] = useState(false);

  const testsQ = useApiQuery<{ data: QuantumTest[] }>(
    ['quanta', 'tests', quantumId],
    `/quanta/${quantumId}/tests`,
    { enabled: false }, // заглушка, эндпоинт не зарегистрирован — добавим в будущем
  );
  void testsQ;

  const runTestM = useMutation({
    mutationFn: (cellIds: string[]) =>
      apiPost(`/quanta/${quantumId}/test`, { cell_ids: cellIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quanta'] });
      setTestForm(false);
    },
  });

  return (
    <Card
      title="Тестирование"
      subtitle="3–5 ячеек (I.3.5.2). ≥ 3 успешных тестов в разных ячейках для масштабирования."
    >
      {rights.hasRight('quantum', 'E') ? (
        <div style={styles.actions}>
          <Button variant="primary" onClick={() => setTestForm(true)}>
            Запустить тест
          </Button>
          <Button variant="secondary" onClick={() => setRecordForm(true)}>
            Записать результат
          </Button>
        </div>
      ) : null}

      <div style={styles.dim}>
        Результаты записываются через «Записать результат» — по одному на ячейку.
      </div>

      {testForm ? (
        <Modal onClose={() => setTestForm(false)} title="Запустить тест">
          <Form<z.infer<typeof testSchema>>
            schema={testSchema}
            defaultValues={{ cell_ids_text: '' }}
            submitLabel="Запустить"
            onCancel={() => setTestForm(false)}
            onSubmit={async (data) => {
              const ids = data.cell_ids_text
                .split(/[,\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              await runTestM.mutateAsync(ids);
            }}
          >
            <FormTextarea
              name="cell_ids_text"
              label="UUID ячеек через запятую (3–5)"
              rows={3}
              required
            />
          </Form>
        </Modal>
      ) : null}

      {recordForm ? (
        <Modal onClose={() => setRecordForm(false)} title="Записать результат теста">
          <Form<z.infer<typeof testRecordSchema>>
            schema={testRecordSchema}
            defaultValues={{ cell_id: '', result: 'success', notes: '' }}
            submitLabel="Записать"
            onCancel={() => setRecordForm(false)}
            onSubmit={async (data) => {
              await apiPost(`/quanta/${quantumId}/test-record`, data);
              void qc.invalidateQueries({ queryKey: ['quanta'] });
              setRecordForm(false);
            }}
          >
            <FormInput name="cell_id" label="UUID ячейки" required />
            <FormSelect
              name="result"
              label="Результат"
              options={[
                { value: 'success', label: 'Успех' },
                { value: 'failure', label: 'Провал' },
              ]}
              required
            />
            <FormTextarea name="notes" label="Заметки" rows={2} />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Обязательные ───────────────────────────────────────────────

function MandatoryTab(): ReactElement {
  const q = useApiQuery<{ data: Quantum[] }>(
    ['quanta', 'mandatory'],
    '/quanta/mandatory',
  );
  const quanta = q.data?.data ?? [];

  const columns: Column<Quantum>[] = [
    { key: 'level', title: 'Уровень', width: 80, render: (r) => `L${r.level}` },
    { key: 'type', title: 'Тип', render: (r) => <span style={styles.mono}>{r.type}</span> },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      ),
    },
    { key: 'description', title: 'Описание', render: (r) => r.description.slice(0, 120) },
  ];

  return (
    <Card
      title="Обязательные кванты"
      subtitle="Применяются автоматически в новых общинах"
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<Quantum>
          data={quanta}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Обязательных квантов нет"
        />
      )}
    </Card>
  );
}

// ─── Обнаружение ────────────────────────────────────────────────

function DetectTab(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creatingFrom, setCreatingFrom] = useState<DetectCandidate | null>(null);

  const detectQ = useApiQuery<{ data: DetectCandidate[] }>(
    ['quanta', 'detect'],
    '/quanta/detect',
  );

  const candidates = detectQ.data?.data ?? [];

  const columns: Column<DetectCandidate>[] = [
    {
      key: 'cellId',
      title: 'Ячейка',
      render: (r) => <span style={styles.mono}>{r.cellId.slice(0, 12)}…</span>,
    },
    {
      key: 'advantage',
      title: 'Преимущество',
      width: 140,
      render: (r) => <Badge tone="success">+{r.advantage.toFixed(1)}%</Badge>,
    },
    {
      key: 'actions',
      title: '',
      width: 160,
      render: (r) =>
        rights.hasRight('quantum', 'C') ? (
          <Button variant="primary" onClick={() => setCreatingFrom(r)}>
            Создать квант
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Обнаружение квантов"
      subtitle="Ячейки с эффективностью выше средней на 30%+ (I.3.3.1)"
    >
      {detectQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<DetectCandidate>
          data={candidates}
          columns={columns}
          getRowId={(r) => r.cellId}
          emptyMessage="Потенциальных квантов нет"
        />
      )}

      {creatingFrom ? (
        <Modal onClose={() => setCreatingFrom(null)} title="Новый квант">
          <CreateQuantumForm
            prefilledCellId={creatingFrom.cellId}
            onClose={() => setCreatingFrom(null)}
            onCreated={(id) => {
              setCreatingFrom(null);
              void qc.invalidateQueries({ queryKey: ['quanta'] });
              void id;
            }}
          />
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Форма создания ─────────────────────────────────────────────

function CreateQuantumForm({
  prefilledCellId,
  onClose,
  onCreated,
}: {
  prefilledCellId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const user = useUser();
  void user;

  return (
    <Form<z.infer<typeof createSchema>>
      schema={createSchema}
      defaultValues={{
        level: 1,
        type: '',
        source_cell_id: prefilledCellId ?? '',
        description: '',
        mandatory: false,
      }}
      submitLabel="Обнаружить"
      onCancel={onClose}
      onSubmit={async (data) => {
        const created = await apiPost<{ id: string }>('/quanta', data);
        onCreated(created.id);
      }}
    >
      <FormSelect
        name="level"
        label="Уровень (1–6)"
        options={[1, 2, 3, 4, 5, 6].map((l) => ({
          value: String(l),
          label: LEVEL_LABEL[l] ?? `L${l}`,
        }))}
        required
      />
      <FormInput name="type" label="Тип кванта" required />
      <FormInput
        name="source_cell_id"
        label="UUID ячейки-источника"
        required
        disabled={Boolean(prefilledCellId)}
      />
      <FormTextarea
        name="description"
        label="Описание"
        rows={4}
        required
      />
    </Form>
  );
}

// ─── Modal / helpers ────────────────────────────────────────────

function Modal({
  children,
  title,
  onClose,
}: {
  children: ReactElement;
  title: string;
  onClose: () => void;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title={title}>{children}</Card>
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    height: '100%',
    minHeight: 0,
    gap: spacing.md,
  },
  header: { display: 'flex' as const, flexDirection: 'column' as const, gap: 4 },
  title: { margin: 0, fontSize: 22, color: colors.text },
  subtitle: { color: colors.textMuted, fontSize: fontSize.sm },
  tabs: {
    display: 'flex' as const,
    gap: 4,
    flexWrap: 'wrap' as const,
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  tab: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    padding: '8px 14px',
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    borderRadius: `${radius.sm}px ${radius.sm}px 0 0`,
    fontFamily: 'inherit',
  },
  tabActive: {
    background: colors.bgSoft,
    color: colors.text,
    borderBottom: `2px solid ${colors.primary}`,
  },
  split: {
    display: 'grid' as const,
    gridTemplateColumns: '340px 1fr',
    gap: spacing.md,
    flex: 1,
    minHeight: 0,
  },
  list: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    overflowY: 'auto' as const,
    paddingRight: 4,
  },
  listItem: {
    textAlign: 'left' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    padding: '10px 12px',
    cursor: 'pointer',
    color: colors.text,
    fontFamily: 'inherit',
    fontSize: fontSize.sm,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  listItemActive: {
    border: `1px solid ${colors.primary}`,
    background: 'rgba(59, 130, 246, 0.08)',
  },
  listItemTop: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  listItemDesc: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.35,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box' as const,
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
  listItemMeta: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    fontSize: fontSize.xs,
    justifyContent: 'space-between' as const,
  },
  detail: { overflowY: 'auto' as const, display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  detailHeader: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  criteriaGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  criteriaBlock: {
    padding: spacing.sm,
    background: colors.bgSoft,
    borderRadius: radius.sm,
  },
  json: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textMuted,
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  actions: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginTop: spacing.sm,
  },
  filters: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.textDim },
  dim: { color: colors.textDim, fontSize: fontSize.xs },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
    padding: 20,
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
    maxWidth: 560,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
};