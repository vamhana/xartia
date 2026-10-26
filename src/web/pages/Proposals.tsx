// F.4.02.38 — Предложения изменений ядра (мета-процесс).
//
// Список, создание, обсуждение, возражения, решение, PR, принятие.

import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { colors, fontSize, radius, spacing } from '../theme';

interface Invariant {
  id: string;
  statement: string;
  module: string;
  testPath: string;
}

interface ProposalSummary {
  id: string;
  type: string;
  title: string;
  status: string;
  authorId: string;
  deadline: string | null;
  prUrl: string | null;
  createdAt: string;
  impactCount: number;
  openObjections: number;
}

interface Proposal extends ProposalSummary {
  problem: string;
  proposal: string;
  alternatives: string | null;
  discussionUrl: string | null;
  impacts: Array<{ invariantId: string; changeKind: string; migrationNote: string | null }>;
  objections: Array<{
    id: string; authorId: string; kind: string; text: string;
    status: string; resolution: string | null; createdAt: string;
  }>;
  decisions: Array<{
    id: string; decidedBy: string; method: string; outcome: string;
    rationale: string; createdAt: string;
  }>;
  events: Array<{ fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
}

const TYPE_LABEL: Record<string, string> = {
  module: 'функция', rule: 'правило', meta: 'обсуждение', charter: 'Хартия',
};
const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
  draft: 'default', discussion: 'info', agreed: 'success',
  rejected: 'danger', implementing: 'warning', accepted: 'success', withdrawn: 'default',
};

export function ProposalsPage(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const listQ = useQuery({
    queryKey: ['proposals', filter],
    queryFn: () => apiGet<{ data: ProposalSummary[] }>(
      `/proposals${filter ? `?status=${filter}` : ''}`,
    ),
  });
  const invariantsQ = useQuery({
    queryKey: ['invariants'],
    queryFn: () => apiGet<{ data: Invariant[] }>('/invariants'),
  });

  const items = listQ.data?.data ?? [];

  if (listQ.isLoading) {return <Spinner label="Загрузка предложений…" />;}

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Предложения</h1>
          <div style={styles.muted}>
            Изменения правил и функций ядра: обсуждение → возражения → решение → PR → принятие
          </div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>+ Предложить изменение</Button>
      </header>

      <div style={styles.filters}>
        {['', 'draft', 'discussion', 'agreed', 'rejected', 'implementing', 'accepted'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            style={{ ...styles.filter, ...(filter === s ? styles.filterActive : {}) }}
          >
            {s || 'все'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Card title="Предложений нет" subtitle="Это не баг-трекер, а способ менять правила">
          <p style={styles.muted}>
            Если что-то в системе устроено неправильно — создайте предложение.
            Оно пройдёт обсуждение, возражения и решение по правилам, а не «как решит мейнтейнер».
          </p>
        </Card>
      ) : (
        <Card title="Список" subtitle={`${items.length}`}>
          {items.map((p) => (
            <div key={p.id} style={styles.row} onClick={() => setSelectedId(p.id)} role="button" tabIndex={0}>
              <div style={styles.rowMain}>
                <div style={styles.rowTitle}>
                  {p.title}
                  <Badge tone="info">{TYPE_LABEL[p.type] ?? p.type}</Badge>
                </div>
                <div style={styles.muted}>
                  {new Date(p.createdAt).toLocaleDateString('ru-RU')}
                  {p.deadline ? ` · до ${new Date(p.deadline).toLocaleDateString('ru-RU')}` : ''}
                  {` · инвариантов ${p.impactCount}`}
                </div>
              </div>
              {p.openObjections > 0 && (
                <Badge tone="warning">{`возражений ${p.openObjections}`}</Badge>
              )}
              <Badge tone={STATUS_TONE[p.status] ?? 'default'}>{p.status}</Badge>
            </div>
          ))}
        </Card>
      )}

      {creating && (
        <CreateProposal
          invariants={invariantsQ.data?.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
            void qc.invalidateQueries({ queryKey: ['proposals'] });
          }}
        />
      )}

      {selectedId && (
        <ProposalDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { void qc.invalidateQueries({ queryKey: ['proposals'] }); }}
        />
      )}
    </div>
  );
}

function CreateProposal({
  invariants,
  onClose,
  onCreated,
}: {
  invariants: Invariant[];
  onClose: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const [type, setType] = useState('rule');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [proposal, setProposal] = useState('');
  const [alternatives, setAlternatives] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [breaking, setBreaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/proposals', {
      type, title, problem, proposal,
      ...(alternatives.trim() ? { alternatives } : {}),
      invariants: selected,
      breaking,
    }),
    onSuccess: (r) => onCreated(r.id),
    onError: (e) => setError(e instanceof Error ? e.message : 'Ошибка'),
  });

  const toggle = (id: string): void => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <b>Новое предложение</b>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>

        <label style={styles.label}>Тип</label>
        <select style={styles.input} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="module">module — поведение функции</option>
          <option value="rule">rule — правило системы</option>
          <option value="meta">meta — сам процесс обсуждения</option>
          <option value="charter">charter — статья Хартии</option>
        </select>

        <label style={styles.label}>Заголовок *</label>
        <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />

        <label style={styles.label}>Проблема *</label>
        <textarea style={styles.textarea} rows={4} value={problem} onChange={(e) => setProblem(e.target.value)} />

        <label style={styles.label}>Предложение *</label>
        <textarea style={styles.textarea} rows={5} value={proposal} onChange={(e) => setProposal(e.target.value)} />

        <label style={styles.label}>Альтернативы</label>
        <textarea style={styles.textarea} rows={3} value={alternatives} onChange={(e) => setAlternatives(e.target.value)} />

        <label style={styles.label}>Затронутые инварианты *</label>
        <div style={styles.invGrid}>
          {invariants.map((i) => (
            <label key={i.id} style={styles.invItem} title={i.statement}>
              <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
              <code style={styles.code}>{i.id}</code>
            </label>
          ))}
        </div>

        <label style={styles.checkRow}>
          <input type="checkbox" checked={breaking} onChange={(e) => setBreaking(e.target.checked)} />
          <span>Breaking change (нужен план миграции)</span>
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.modalActions}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            disabled={title.length < 5 || problem.length < 20 || proposal.length < 20 || selected.length === 0}
            onClick={() => m.mutate()}
          >
            Создать
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProposalDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const [notice, setNotice] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [objectionKind, setObjectionKind] = useState('conceptual');
  const [objectionText, setObjectionText] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [days, setDays] = useState(7);

  const q = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => apiGet<Proposal>(`/proposals/${id}`),
  });

  const act = useMutation({
    mutationFn: async (action:
      | { kind: 'discussion' }
      | { kind: 'objection' }
      | { kind: 'resolve'; objectionId: string }
      | { kind: 'decide'; outcome: 'accepted' | 'rejected' }
      | { kind: 'implement' }
      | { kind: 'accept' }
      | { kind: 'withdraw' }) => {
      switch (action.kind) {
        case 'discussion':
          return apiPost(`/proposals/${id}/discussion`, { days });
        case 'objection':
          return apiPost(`/proposals/${id}/objections`, { kind: objectionKind, text: objectionText });
        case 'resolve':
          return apiPost(`/proposals/${id}/objections/${action.objectionId}/resolve`, {
            status: 'addressed',
            resolution: rationale || 'Ответ дан в обсуждении',
          });
        case 'decide':
          return apiPost(`/proposals/${id}/decide`, {
            outcome: action.outcome,
            rationale,
            method: 'council',
          });
        case 'implement':
          return apiPost(`/proposals/${id}/implement`, { pr_url: prUrl });
        case 'accept':
          return apiPost(`/proposals/${id}/accept`, {});
        case 'withdraw':
          return apiPost(`/proposals/${id}/withdraw`, {});
      }
    },
    onSuccess: () => {
      setNotice('Готово');
      setObjectionText('');
      setRationale('');
      void q.refetch();
      onChanged();
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка'),
  });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modalWide} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <b>{q.data?.title ?? 'Предложение'}</b>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>
        {q.isLoading && <div style={styles.muted}>Загрузка…</div>}
        {q.data && (
          <>
            <div style={styles.rowLine}>
              <Badge tone="info">{TYPE_LABEL[q.data.type] ?? q.data.type}</Badge>
              <Badge tone={STATUS_TONE[q.data.status] ?? 'default'}>{q.data.status}</Badge>
              {q.data.deadline && (
                <span style={styles.muted}>до {new Date(q.data.deadline).toLocaleString('ru-RU')}</span>
              )}
            </div>

            <div style={styles.section}>Проблема</div>
            <div style={styles.text}>{q.data.problem}</div>
            <div style={styles.section}>Предложение</div>
            <div style={styles.text}>{q.data.proposal}</div>
            {q.data.alternatives && (
              <>
                <div style={styles.section}>Альтернативы</div>
                <div style={styles.text}>{q.data.alternatives}</div>
              </>
            )}

            <div style={styles.section}>Инварианты</div>
            {q.data.impacts.map((i) => (
              <div key={i.invariantId} style={styles.invRow}>
                <code style={styles.code}>{i.invariantId}</code>
                <Badge tone={i.changeKind === 'breaking' ? 'danger' : 'default'}>{i.changeKind}</Badge>
              </div>
            ))}

            <div style={styles.section}>Возражения</div>
            {q.data.objections.length === 0 && <div style={styles.muted}>Возражений нет</div>}
            {q.data.objections.map((o) => (
              <div key={o.id} style={styles.objection}>
                <div style={styles.rowLine}>
                  <Badge tone={o.status === 'open' ? 'warning' : 'success'}>{`${o.kind} · ${o.status}`}</Badge>
                  {o.status === 'open' && (
                    <Button variant="ghost" size="sm" onClick={() => act.mutate({ kind: 'resolve', objectionId: o.id })}>
                      Ответить
                    </Button>
                  )}
                </div>
                <div style={styles.text}>{o.text}</div>
                {o.resolution && <div style={styles.muted}>Ответ: {o.resolution}</div>}
              </div>
            ))}

            {q.data.status === 'discussion' && (
              <>
                <div style={styles.section}>Добавить возражение</div>
                <div style={styles.rowLine}>
                  <select style={styles.input} value={objectionKind} onChange={(e) => setObjectionKind(e.target.value)}>
                    <option value="factual">factual</option>
                    <option value="conceptual">conceptual</option>
                    <option value="compatibility">compatibility</option>
                  </select>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    value={objectionText}
                    onChange={(e) => setObjectionText(e.target.value)}
                    placeholder="Текст возражения"
                  />
                  <Button
                    variant="secondary"
                    loading={act.isPending}
                    disabled={objectionText.length < 10}
                    onClick={() => act.mutate({ kind: 'objection' })}
                  >
                    Возразить
                  </Button>
                </div>
              </>
            )}

            <div style={styles.section}>Решение</div>
            {q.data.decisions.map((d) => (
              <div key={d.id} style={styles.objection}>
                <div style={styles.rowLine}>
                  <Badge tone={d.outcome === 'accepted' ? 'success' : 'danger'}>{d.outcome}</Badge>
                  <span style={styles.muted}>{d.method}</span>
                </div>
                <div style={styles.text}>{d.rationale}</div>
              </div>
            ))}

            {notice && <div style={styles.notice}>{notice}</div>}

            <div style={styles.actions}>
              {q.data.status === 'draft' && (
                <>
                  <input
                    style={{ ...styles.input, width: 80 }}
                    type="number"
                    min={1}
                    max={30}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                  <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ kind: 'discussion' })}>
                    Начать обсуждение
                  </Button>
                </>
              )}
              {q.data.status === 'discussion' && (
                <>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Обоснование решения (мин. 20 символов)"
                  />
                  <Button
                    variant="primary"
                    disabled={rationale.length < 20 || q.data.openObjections > 0}
                    loading={act.isPending}
                    onClick={() => act.mutate({ kind: 'decide', outcome: 'accepted' })}
                  >
                    Принять
                  </Button>
                  <Button
                    variant="danger"
                    disabled={rationale.length < 20}
                    loading={act.isPending}
                    onClick={() => act.mutate({ kind: 'decide', outcome: 'rejected' })}
                  >
                    Отклонить
                  </Button>
                </>
              )}
              {q.data.status === 'agreed' && (
                <>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    value={prUrl}
                    onChange={(e) => setPrUrl(e.target.value)}
                    placeholder="https://github.com/.../pull/..."
                  />
                  <Button
                    variant="primary"
                    disabled={!prUrl.startsWith('http')}
                    loading={act.isPending}
                    onClick={() => act.mutate({ kind: 'implement' })}
                  >
                    Реализую (PR)
                  </Button>
                </>
              )}
              {q.data.status === 'implementing' && (
                <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ kind: 'accept' })}>
                  Принять изменение
                </Button>
              )}
              {['draft', 'discussion'].includes(q.data.status) && (
                <Button variant="ghost" loading={act.isPending} onClick={() => act.mutate({ kind: 'withdraw' })}>
                  Отозвать
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  h1: { margin: 0, fontSize: fontSize.xl, color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  filter: {
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    borderRadius: radius.sm,
    padding: '4px 10px',
    cursor: 'pointer' as const,
    fontSize: fontSize.xs,
  },
  filterActive: { color: colors.text, borderColor: colors.primary, background: colors.bgSoft },
  row: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer' as const,
  },
  rowMain: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  rowTitle: { display: 'flex', gap: 8, alignItems: 'center', color: colors.text, fontSize: fontSize.sm },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: 'min(680px, 94vw)',
    maxHeight: '90vh',
    overflow: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  modalWide: {
    width: 'min(880px, 96vw)',
    maxHeight: '90vh',
    overflow: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  label: { fontSize: fontSize.sm, color: colors.text, fontWeight: 600 },
  input: {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '8px 10px',
    fontSize: fontSize.sm,
  },
  textarea: {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '8px 10px',
    fontSize: fontSize.sm,
    resize: 'vertical' as const,
  },
  invGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 },
  invItem: { display: 'flex', gap: 6, alignItems: 'center', fontSize: fontSize.sm, color: colors.text },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.text },
  checkRow: { display: 'flex', gap: 6, alignItems: 'center', fontSize: fontSize.sm, color: colors.text },
  section: { marginTop: spacing.sm, fontSize: fontSize.sm, fontWeight: 600, color: colors.text },
  text: { color: colors.text, fontSize: fontSize.sm, whiteSpace: 'pre-wrap' as const },
  rowLine: { display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' as const },
  objection: {
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    padding: spacing.sm,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  invRow: { display: 'flex', gap: spacing.sm, alignItems: 'center', fontSize: fontSize.sm },
  notice: { color: colors.primary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm },
  actions: { display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: spacing.sm },
};
