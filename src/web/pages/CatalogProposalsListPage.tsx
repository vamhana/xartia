// F.4.10.27 — Список предложений каталога (Каталог v0.4, §16.1).
// GET /passport/catalog/proposals?status=&limit=.
// Клик → /catalog/proposals/:id (детали).

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';
import type {
  PassportCatalogProposal,
  PassportCatalogProposalStatus,
  PassportCatalogProposalType,
} from '../types';

const STATUS_TONE: Record<
  PassportCatalogProposalStatus,
  'default' | 'info' | 'success' | 'danger' | 'warning'
> = {
  draft: 'default',
  submitted: 'info',
  in_review: 'warning',
  approved: 'info',
  rejected: 'danger',
  merged: 'success',
};

const TYPE_LABEL: Record<PassportCatalogProposalType, string> = {
  new_atom: 'Новый',
  update_atom: 'Обновление',
  deprecate_atom: 'Устаревание',
};

type StatusFilter = PassportCatalogProposalStatus | '';

export function CatalogProposalsListPage(): ReactElement {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('');

  const q = useApiQuery<{ data: PassportCatalogProposal[] }>(
    ['passport', 'catalog', 'proposals', status],
    `/passport/catalog/proposals?limit=200${status ? `&status=${status}` : ''}`,
  );

  return (
    <div style={{ maxWidth: 1000, display: 'grid', gap: spacing.md }}>
      <div style={styles.headerRow}>
        <h1 style={{ margin: 0 }}>Предложения каталога</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          style={styles.select}
        >
          <option value="">все</option>
          <option value="draft">draft</option>
          <option value="submitted">submitted</option>
          <option value="in_review">in_review</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
          <option value="merged">merged</option>
        </select>
      </div>

      <Card
        title="Все предложения"
        subtitle={q.data ? `${q.data.data.length} (фильтр: ${status || 'все'})` : undefined}
      >
        {q.isLoading && <Spinner label="Загрузка предложений…" />}
        {q.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.sm }}>
            {q.error?.message ?? 'Не удалось загрузить предложения'}
          </div>
        )}
        {q.data && q.data.data.length === 0 && (
          <div style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
            Нет предложений{status ? ` со статусом '${status}'` : ''}.
          </div>
        )}
        {q.data && q.data.data.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Тип</th>
                <th style={styles.th}>Атом</th>
                <th style={styles.th}>Payload</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Создано</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>{TYPE_LABEL[p.proposalType]}</td>
                  <td style={styles.td}>
                    {p.atomId ? (
                      <code style={styles.code}>{p.atomId}</code>
                    ) : (
                      <span style={styles.muted}>—</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.muted}>
                      {summarizePayload(p.payload)}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>
                      {new Date(p.createdAt).toISOString().slice(0, 10)}
                    </code>
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => navigate(`/catalog/proposals/${p.id}`)}
                      style={styles.link}
                    >
                      открыть →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const name = payload['name'];
  if (typeof name === 'string') {return name;}
  const def = payload['definition'];
  if (typeof def === 'string') {return def.slice(0, 60);}
  const reason = payload['reason'];
  if (typeof reason === 'string') {return reason.slice(0, 60);}
  const keys = Object.keys(payload);
  if (keys.length === 0) {return '(пусто)';}
  return keys.join(', ');
}

const styles = {
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  } as const,
  select: {
    padding: '4px 8px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
  } as const,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '6px 8px', fontSize: fontSize.sm },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  link: {
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    fontSize: fontSize.sm,
    padding: 0,
  } as const,
};