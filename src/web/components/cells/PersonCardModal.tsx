// F.4.02.36 — Карточка человека (общая для карты и страницы ячеек).

import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../api/client';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { colors, fontSize, radius, spacing } from '../../theme';

export interface PersonCardData {
  participant: {
    id: string;
    name: string;
    status: string;
    cellNumber: string | null;
  };
  tasks: Array<{
    id: string;
    externalId: string;
    description: string;
    status: string;
    priority: string;
    deadline: string | null;
    assignedBy: { id: string; name: string } | null;
  }>;
  mentor: { id: string; name: string } | null;
  mentees: Array<{ id: string; name: string }>;
  dailyPlan: Array<{ id: string; externalId: string; description: string; status: string }>;
}

export function PersonCardModal({
  participantId,
  onClose,
}: {
  participantId: string;
  onClose: () => void;
}): ReactElement {
  const q = useQuery({
    queryKey: ['person-card', participantId],
    queryFn: () => apiGet<PersonCardData>(`/participants/${participantId}/card`),
  });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <b>{q.data?.participant.name ?? 'Человек'}</b>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>
        {q.isLoading && <div style={styles.muted}>Загрузка…</div>}
        {q.data && (
          <>
            <div style={styles.muted}>
              {q.data.participant.status}
              {q.data.participant.cellNumber ? ` · ячейка ${q.data.participant.cellNumber}` : ''}
            </div>

            <div style={styles.section}>Текущие задачи</div>
            {q.data.tasks.length === 0 && <div style={styles.muted}>Задач нет</div>}
            {q.data.tasks.map((t) => (
              <div key={t.id} style={styles.row}>
                <span style={styles.text}>
                  {t.externalId}: {t.description}
                  <span style={styles.muted}> · назначил: {t.assignedBy?.name ?? '—'}</span>
                </span>
                <Badge tone="info">{t.status}</Badge>
              </div>
            ))}

            <div style={styles.section}>Наставник и ученики</div>
            <div style={styles.muted}>Наставник: {q.data.mentor?.name ?? '—'}</div>
            <div style={styles.muted}>
              Ученики: {q.data.mentees.length > 0
                ? q.data.mentees.map((m) => m.name).join(', ')
                : '—'}
            </div>

            <div style={styles.section}>Дневной план на сегодня</div>
            {q.data.dailyPlan.length === 0 && <div style={styles.muted}>Задач на день нет</div>}
            {q.data.dailyPlan.map((t) => (
              <div key={t.id} style={styles.row}>
                <span style={styles.text}>{t.externalId}: {t.description}</span>
                <Badge tone="default">{t.status}</Badge>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: 'min(720px, 94vw)',
    maxHeight: '86vh',
    overflow: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  section: { marginTop: spacing.sm, fontSize: fontSize.sm, fontWeight: 600, color: colors.text },
  row: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  text: { flex: 1, color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
};
