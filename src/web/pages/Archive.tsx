// src/web/pages/Archive.tsx
/**
 * F.4.02.12 — Archive page.
 *
 * Документы + FTS-поиск + цепочки решений + sign + cross-check + pressure.
 * URL-sync: ?selected=<id> открывает деталь (из CommandPalette).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
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

type ArchiveDocType = 'protocol' | 'decision' | 'act' | 'report' | 'journal';

interface ArchiveDocument {
  id: string;
  type: ArchiveDocType;
  directionId: string | null;
  subject: string;
  content: Record<string, unknown>;
  version: number;
  signedBy: string | null;
  signature: string | null;
  archivedAt: string | null;
  createdAt: string;
}

interface DecisionChainStep {
  id: string;
  chainId: string;
  step: number;
  type: string;
  refId: string;
  description: string;
  createdAt: string;
}

interface IdRegistryEntry {
  id: string;
  participantId: string;
  externalId: string;
  communityCode: string | null;
  globalId: string | null;
  internalId: string | null;
}

interface ListResponse {
  data: ArchiveDocument[];
  meta: { page: number; per_page: number; total: number };
}

// ─── Константы ───────────────────────────────────────────────────

const TYPE_LABEL: Record<ArchiveDocType, string> = {
  protocol: 'Протокол',
  decision: 'Решение',
  act: 'Акт',
  report: 'Отчёт',
  journal: 'Журнал',
};

const CHAIN_STEP_LABEL: Record<string, string> = {
  problem: 'Проблема',
  request: 'Запрос',
  response: 'Ответ',
  decision: 'Решение',
  realization: 'Реализация',
  result: 'Результат',
  correction: 'Коррекция',
};

const createSchema = z.object({
  type: z.enum(['protocol', 'decision', 'act', 'report', 'journal']),
  subject: z.string().min(1, 'Укажите тему').max(255),
  content_text: z.string().min(1, 'Заполните содержимое').max(20000),
});

type CreateDocForm = z.infer<typeof createSchema>;

const chainStepSchema = z.object({
  chain_id: z.string().uuid('UUID цепочки'),
  type: z.enum(['problem', 'request', 'response', 'decision', 'realization', 'result', 'correction']),
  ref_id: z.string().min(1, 'Укажите ref_id'),
  description: z.string().min(1, 'Укажите описание').max(2000),
});

type ChainStepForm = z.infer<typeof chainStepSchema>;

// ─── Парсинг JSON ────────────────────────────────────────────────

function safeParseJson(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { text: input };
  }
}

// ─── Страница ────────────────────────────────────────────────────

export function ArchivePage(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const rights = useRights();

  const [filterType, setFilterType] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [chainFor, setChainFor] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const selectedFromUrl = searchParams.get('selected');

  useEffect(() => {
    if (selectedFromUrl && selectedFromUrl !== selectedId) {
      setSelectedId(selectedFromUrl);
    }
  }, [selectedFromUrl, selectedId]);

  const directionId = user?.participant.directionId ?? '';

  const listQ = useApiQuery<ListResponse>(
    ['archive', 'list', filterType, searchQ],
    searchQ
      ? `/archive/search?q=${encodeURIComponent(searchQ)}`
      : `/archive?page=1&per_page=100${filterType ? `&type=${filterType}` : ''}`,
  );

  const rows = listQ.data?.data ?? [];

  const columns: Column<ArchiveDocument>[] = useMemo(
    () => [
      {
        key: 'type',
        title: 'Тип',
        width: 120,
        render: (r) => <Badge tone="info">{TYPE_LABEL[r.type] ?? r.type}</Badge>,
      },
      { key: 'subject', title: 'Тема', sortable: true },
      {
        key: 'version',
        title: 'Версия',
        width: 80,
        align: 'center',
        sortable: true,
      },
      {
        key: 'signedBy',
        title: 'Подпись',
        width: 110,
        render: (r) =>
          r.signedBy ? (
            <Badge tone="success">Подписан</Badge>
          ) : (
            <Badge tone="default">Нет</Badge>
          ),
      },
      {
        key: 'createdAt',
        title: 'Создан',
        width: 140,
        render: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU'),
      },
    ],
    [],
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Архив</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Добавить документ
        </Button>
      </div>

      <div style={styles.filters}>
        <input
          style={styles.searchInput}
          placeholder="Поиск по теме (FTS)…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        {!searchQ ? (
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={styles.select}
          >
            <option value="">Все типы</option>
            {(Object.keys(TYPE_LABEL) as ArchiveDocType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        ) : (
          <Button variant="ghost" onClick={() => setSearchQ('')}>
            Очистить поиск
          </Button>
        )}
      </div>

      {listQ.isLoading ? (
        <Spinner label="Загружаем документы…" />
      ) : (
        <Table<ArchiveDocument>
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          emptyMessage={searchQ ? 'Ничего не найдено' : 'Документов нет'}
        />
      )}

      {selectedId ? (
        <DocumentPanel
          documentId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {creating ? (
        <CreateDocumentModal
          directionId={directionId}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {chainFor ? (
        <ChainPanel chainId={chainFor} onClose={() => setChainFor(null)} />
      ) : null}

      {/* Цепочки — раздел ниже */}
      <Card
        title="Цепочки решений"
        subtitle="Построение цепочек: проблема → запрос → ответ → решение → реализация → результат → коррекция"
        actions={
          <Button
            variant="secondary"
            onClick={() => void qc.invalidateQueries({ queryKey: ['archive', 'chains'] })}
          >
            Обновить
          </Button>
        }
      >
        <ChainsList onSelect={(id) => setChainFor(id)} />
      </Card>

      {/* Справочники */}
      <div style={styles.twoCol}>
        <IdRegistryPanel />
        <CrossCheckPanel />
      </div>

      {/* Права на sign / pressure */}
      {rights.hasRight('archive', 'S') || rights.hasRole('KEEPER') ? (
        <PressurePanel />
      ) : null}
    </div>
  );
}

// ─── Карточка документа ──────────────────────────────────────────

function DocumentPanel({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [keeperId, setKeeperId] = useState(user?.participant.id ?? '');
  const [err, setErr] = useState<string | null>(null);

  const docQ = useApiQuery<ArchiveDocument>(
    ['archive', 'detail', documentId],
    `/archive/${documentId}`,
  );

  const signM = useMutation({
    mutationFn: () =>
      apiPost<{ document: ArchiveDocument; signature: string }>(
        `/archive/${documentId}/sign`,
        { keeper_id: keeperId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['archive', 'detail', documentId] });
      void qc.invalidateQueries({ queryKey: ['archive', 'list'] });
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось подписать'),
  });

  if (docQ.isLoading) {
    return (
      <SidePanel onClose={onClose}>
        <Spinner label="Загружаем документ…" />
      </SidePanel>
    );
  }
  if (docQ.isError || !docQ.data) {
    return (
      <SidePanel onClose={onClose}>
        <p style={styles.muted}>Не удалось загрузить документ</p>
      </SidePanel>
    );
  }

  const d = docQ.data;
  const contentStr = JSON.stringify(d.content ?? {}, null, 2);

  return (
    <SidePanel onClose={onClose}>
      <div style={styles.panelHeader}>
        <h2 style={styles.panelTitle}>{d.subject}</h2>
        <Badge tone="info">{TYPE_LABEL[d.type] ?? d.type}</Badge>
      </div>
      <div style={styles.panelMeta}>
        <span>Версия: {d.version}</span>
        <span>Создан: {new Date(d.createdAt).toLocaleString('ru-RU')}</span>
        {d.signedBy ? (
          <span style={{ color: colors.success }}>✓ Подписан</span>
        ) : (
          <span style={{ color: colors.warning }}>Не подписан</span>
        )}
      </div>

      {d.signature ? (
        <div style={styles.signatureBlock}>
          <div style={styles.signatureLabel}>Подпись (HMAC-SHA256)</div>
          <div style={styles.signatureValue}>{d.signature}</div>
        </div>
      ) : null}

      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>Содержимое</div>
        <pre style={styles.pre}>{contentStr}</pre>
      </div>

      {!d.signedBy ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Подписать</div>
          <input
            style={styles.input}
            placeholder="UUID Хранителя"
            value={keeperId}
            onChange={(e) => setKeeperId(e.target.value)}
          />
          <Button
            variant="primary"
            onClick={() => {
              setErr(null);
              void signM.mutateAsync();
            }}
            disabled={signM.isPending || !keeperId.trim()}
          >
            {signM.isPending ? '…' : 'Подписать'}
          </Button>
          {err ? <div style={styles.error}>{err}</div> : null}
        </div>
      ) : null}

      <div style={styles.panelActions}>
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </SidePanel>
  );
}

// ─── Модалка создания ────────────────────────────────────────────

function CreateDocumentModal({
  directionId,
  onClose,
}: {
  directionId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CreateDocForm) =>
      apiPost<ArchiveDocument>('/archive', {
        type: data.type,
        direction_id: directionId,
        subject: data.subject,
        content: safeParseJson(data.content_text),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['archive'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Новый документ">
          <Form<CreateDocForm>
            schema={createSchema}
            defaultValues={{
              type: 'protocol',
              subject: '',
              content_text: '{\n  "attendees": [],\n  "decisions": []\n}',
            }}
            submitLabel="Создать"
            onCancel={onClose}
            loading={createM.isPending}
            onSubmit={async (data) => {
              setErr(null);
              await createM.mutateAsync(data);
            }}
          >
            <FormSelect
              name="type"
              label="Тип"
              required
              options={(Object.keys(TYPE_LABEL) as ArchiveDocType[]).map((t) => ({
                value: t,
                label: TYPE_LABEL[t],
              }))}
            />
            <FormInput
              name="subject"
              label="Тема"
              placeholder="Например: Заседание Совета 2026-10-10"
              required
            />
            <FormTextarea
              name="content_text"
              label="Содержимое (JSON или текст)"
              rows={8}
              maxLength={20000}
              required
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Цепочки ─────────────────────────────────────────────────────

function ChainsList({
  onSelect,
}: {
  onSelect: (chainId: string) => void;
}): ReactElement {
  // В API нет списка всех цепочек, только /chains/:id и /chains/:id/rebuild.
  // Показываем форму для ввода chain_id + кнопку "Открыть".
  const [chainId, setChainId] = useState('');

  return (
    <div style={styles.chainInput}>
      <input
        style={styles.input}
        placeholder="UUID цепочки (например, из логов)"
        value={chainId}
        onChange={(e) => setChainId(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={!chainId.trim()}
        onClick={() => onSelect(chainId.trim())}
      >
        Открыть
      </Button>
      <ChainStepModalWrapper />
    </div>
  );
}

function ChainStepModalWrapper(): ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: ChainStepForm) =>
      apiPost<DecisionChainStep>('/archive/chains', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['archive', 'chains'] });
      setOpen(false);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        + Добавить шаг
      </Button>
    );
  }

  return (
    <div style={styles.inlineForm}>
      <Form<ChainStepForm>
        schema={chainStepSchema}
        defaultValues={{
          chain_id: '',
          type: 'problem',
          ref_id: '',
          description: '',
        }}
        submitLabel="Добавить"
        cancelLabel="Отмена"
        onCancel={() => setOpen(false)}
        loading={createM.isPending}
        onSubmit={async (data) => {
          setErr(null);
          await createM.mutateAsync(data);
        }}
      >
        <FormInput name="chain_id" label="UUID цепочки" required />
        <FormSelect
          name="type"
          label="Тип шага"
          required
          options={Object.entries(CHAIN_STEP_LABEL).map(([v, l]) => ({
            value: v,
            label: l,
          }))}
        />
        <FormInput name="ref_id" label="Ref ID (ссылка на объект)" required />
        <FormTextarea name="description" label="Описание" rows={3} required />
        {err ? <div style={styles.error}>{err}</div> : null}
      </Form>
    </div>
  );
}

function ChainPanel({
  chainId,
  onClose,
}: {
  chainId: string;
  onClose: () => void;
}): ReactElement {
  const chainQ = useApiQuery<{ data: DecisionChainStep[] }>(
    ['archive', 'chain', chainId],
    `/archive/chains/${chainId}`,
  );
  const rebuildQ = useApiQuery<{ valid: boolean; gaps: number[] }>(
    ['archive', 'chain', chainId, 'rebuild'],
    `/archive/chains/${chainId}/rebuild`,
  );

  const steps = chainQ.data?.data ?? [];

  return (
    <SidePanel onClose={onClose}>
      <h2 style={styles.panelTitle}>Цепочка {chainId.slice(0, 8)}…</h2>

      {rebuildQ.data ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Целостность</div>
          {rebuildQ.data.valid ? (
            <Badge tone="success">Валидна</Badge>
          ) : (
            <div>
              <Badge tone="danger">
                {`Разрывы: ${rebuildQ.data.gaps?.join(', ') ?? '—'}`}
              </Badge>
            </div>
          )}
        </div>
      ) : null}

      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>Шаги ({steps.length})</div>
        {steps.length === 0 ? (
          <p style={styles.muted}>Пусто</p>
        ) : (
          steps.map((s) => (
            <div key={s.id} style={styles.chainStep}>
              <div style={styles.chainStepHeader}>
                <Badge tone="info">
                  {`#${s.step} · ${CHAIN_STEP_LABEL[s.type] ?? s.type}`}
                </Badge>
                <span style={styles.chainStepDate}>
                  {new Date(s.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
              <div style={styles.chainStepDesc}>{s.description}</div>
            </div>
          ))
        )}
      </div>

      <Button variant="ghost" onClick={onClose}>Закрыть</Button>
    </SidePanel>
  );
}

// ─── Реестр ID ───────────────────────────────────────────────────

function IdRegistryPanel(): ReactElement {
  const idsQ = useApiQuery<{ data: IdRegistryEntry[] }>(
    ['archive', 'ids'],
    '/archive/ids',
  );

  const rows = idsQ.data?.data ?? [];

  return (
    <Card title="Реестр ID" subtitle={`Всего ${rows.length}`}>
      {idsQ.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p style={styles.muted}>Пусто</p>
      ) : (
        <div style={styles.idList}>
          {rows.slice(0, 20).map((r) => (
            <div key={r.id} style={styles.idRow}>
              <span style={styles.idExternal}>{r.externalId}</span>
              <span style={styles.idGlobal}>
                {r.globalId ?? <span style={styles.muted}>— global —</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Cross-check ─────────────────────────────────────────────────

function CrossCheckPanel(): ReactElement {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ discrepancies: unknown } | null>(null);

  const doCheck = async (): Promise<void> => {
    setErr(null);
    setResult(null);
    if (!a.trim() || !b.trim()) {
      setErr('Укажите оба UUID');
      return;
    }
    try {
      const r = await apiPost<{ discrepancies: unknown }>('/archive/cross-check', {
        document_a_id: a.trim(),
        document_b_id: b.trim(),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message || 'Не удалось');
    }
  };

  return (
    <Card title="Перекрёстная сверка">
      <div style={styles.crossCheckForm}>
        <input
          style={styles.input}
          placeholder="UUID документа A"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="UUID документа B"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
        <Button variant="secondary" onClick={() => void doCheck()}>
          Сверить
        </Button>
        {err ? <div style={styles.error}>{err}</div> : null}
        {result ? (
          <pre style={styles.pre}>
            {JSON.stringify(result.discrepancies, null, 2)}
          </pre>
        ) : null}
      </div>
    </Card>
  );
}

// ─── Pressure ────────────────────────────────────────────────────

function PressurePanel(): ReactElement {
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async (): Promise<void> => {
    setErr(null);
    setSent(false);
    if (!description.trim()) {
      setErr('Заполните описание');
      return;
    }
    try {
      await apiPost('/archive/pressure', { description: description.trim() });
      setSent(true);
      setDescription('');
    } catch (e) {
      setErr((e as Error).message || 'Не удалось');
    }
  };

  return (
    <Card
      title="Сигнал о давлении"
      subtitle="Для Хранителей: зафиксировать попытку воздействия"
    >
      <div style={styles.pressureForm}>
        <textarea
          style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
          placeholder="Опишите, что произошло…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button variant="danger" onClick={() => void send()}>
          Отправить сигнал
        </Button>
        {sent ? (
          <div style={{ color: colors.success, fontSize: fontSize.sm }}>
            Сигнал создан
          </div>
        ) : null}
        {err ? <div style={styles.error}>{err}</div> : null}
      </div>
    </Card>
  );
}

// ─── SidePanel ───────────────────────────────────────────────────

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
  },
  title: { margin: 0, fontSize: 22, color: colors.text },
  filters: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  searchInput: {
    flex: 1,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '8px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
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
  modal: { width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const },
  sideBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    zIndex: 100,
  },
  sidePanel: {
    width: 560,
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
    cursor: 'pointer' as const,
    lineHeight: 1,
  },
  panelHeader: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    paddingRight: 30,
  },
  panelTitle: { margin: 0, fontSize: 20, color: colors.text, flex: 1 },
  panelMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.xs,
    flexWrap: 'wrap' as const,
  },
  signatureBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    padding: spacing.sm,
    background: 'rgba(34,197,94,0.06)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: radius.sm,
  },
  signatureLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  signatureValue: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: colors.text,
    wordBreak: 'break-all' as const,
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
  pre: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    padding: spacing.sm,
    margin: 0,
    color: colors.text,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    maxHeight: 400,
    overflow: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  panelActions: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  chainInput: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
  },
  inlineForm: {
    width: '100%',
    padding: spacing.md,
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  chainStep: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    padding: spacing.sm,
    background: colors.bg,
    borderRadius: radius.sm,
    borderLeft: `3px solid ${colors.primary}`,
  },
  chainStepHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
  },
  chainStepDate: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  chainStepDesc: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
  },
  twoCol: {
    display: 'grid' as const,
    gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
    gap: spacing.md,
  },
  idList: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  idRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  idExternal: { color: colors.text, fontFamily: 'monospace' },
  idGlobal: { color: colors.textMuted, fontFamily: 'monospace' },
  crossCheckForm: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  pressureForm: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
};