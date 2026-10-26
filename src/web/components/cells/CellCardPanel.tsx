// F.4.02.37 — Карточка ячейки: состав, общий план, дневной план.
// Клик по человеку открывает его паспорт.

import type { ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../api/client';
import { Badge } from '../ui/Badge';
import { colors, fontSize, spacing } from '../../theme';
import { PersonCardModal } from './PersonCardModal';

export interface CellCardData {
  cell: {
    id: string; number: string; level: number;
    profile: string | null; status: string;
  };
  members: Array<{
    participantId: string; name: string; roleInCell: string; status: string;
  }>;
  plans: Array<{ id: string; title: string; status: string; version: number }>;
  dailyPlan: {
    status: string;
    tasks: Array<{
      external_id: string; description: string; status: string;
      assigned_name?: string | null;
    }>;
  };
}

const LEVEL_LABEL: Record<number, string> = {
  0: 'ячейка', 1: 'группа', 2: 'дом',
};

export function CellCardPanel({ cellId }: { cellId: string }): ReactElement {
  const [personId, setPersonId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['cell-card', cellId],
    queryFn: () => apiGet<CellCardData>(`/cells/${cellId}/card`),
  });

  if (q.isLoading) {return <div style={styles.muted}>Загрузка…</div>;}
  if (!q.data) {return <div style={styles.muted}>Не удалось загрузить карточку</div>;}

  const d = q.data;
  return (
    <div style={styles.wrap}>
      <div style={styles.muted}>
        {d.cell.number} · {LEVEL_LABEL[d.cell.level] ?? `уровень ${d.cell.level}`}
        {d.cell.profile ? ` · ${d.cell.profile}` : ''} · состав {d.members.length}
        {' · '}{d.cell.status}
      </div>

      <div style={styles.section}>Общий план ячейки</div>
      {d.plans.length === 0 && <div style={styles.muted}>Плана нет</div>}
      {d.plans.map((pl) => (
        <div key={pl.id} style={styles.row}>
          <span style={styles.text}>{pl.title}</span>
          <Badge tone={pl.status === 'in_progress' ? 'success' : 'info'}>
            {`${pl.status} v${pl.version}`}
          </Badge>
        </div>
      ))}

      <div style={styles.section}>Люди</div>
      {d.members.map((m) => (
        <div
          key={m.participantId}
          style={styles.row}
          role="button"
          tabIndex={0}
          onClick={() => setPersonId(m.participantId)}
        >
          <span style={styles.text}>{m.name}</span>
          <Badge tone="info">{m.roleInCell}</Badge>
        </div>
      ))}

      <div style={styles.section}>Дневной план ячейки</div>
      {d.dailyPlan.tasks.length === 0 && <div style={styles.muted}>На сегодня задач нет</div>}
      {d.dailyPlan.tasks.map((t) => (
        <div key={t.external_id} style={styles.row}>
          <span style={styles.text}>
            {t.external_id}: {t.description}
            {t.assigned_name ? <span style={styles.muted}> · {t.assigned_name}</span> : null}
          </span>
          <Badge tone="default">{t.status}</Badge>
        </div>
      ))}

      {personId && (
        <PersonCardModal participantId={personId} onClose={() => setPersonId(null)} />
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  section: { marginTop: spacing.sm, fontSize: fontSize.sm, fontWeight: 600, color: colors.text },
  row: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    cursor: 'pointer' as const,
  },
  text: { flex: 1, color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
};
