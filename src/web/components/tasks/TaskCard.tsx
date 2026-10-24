// F.4.03.03 — TaskCard. 4 экспорта: TaskStatusBadge, TaskDeadlineTimer,
// TaskCompetencies, TaskCard. Полная карточка задачи и compact-вариант.

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  PRIORITY_LABEL, PRIORITY_TONE,
  TASK_STATUS_LABEL, TASK_STATUS_TONE,
  describeDeadline, formatDateTime,
} from '../../lib/format';
import { colors, fontSize, radius, spacing } from '../../theme';
import type { Task } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

// ── TaskStatusBadge ────────────────────────────────────────
export function TaskStatusBadge({
  status,
}: { status: Task['status'] }): ReactElement {
  return (
    <Badge tone={TASK_STATUS_TONE[status]}>
      {TASK_STATUS_LABEL[status]}
    </Badge>
  );
}

// ── TaskDeadlineTimer ──────────────────────────────────────
export function TaskDeadlineTimer({
  deadline, priority,
}: {
  deadline: string | null;
  priority: Task['priority'];
}): ReactElement {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deadline) {return undefined;}
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  if (!deadline) {
    return <span style={{ color: colors.textMuted }}>—</span>;
  }
  const dl = describeDeadline(deadline);
  const tone = dl.isOverdue
    ? colors.danger
    : dl.isUrgent
      ? colors.warning
      : colors.text;
  return (
    <span
      style={{
        color: tone,
        fontWeight: dl.isOverdue || dl.isUrgent ? 600 : 400,
      }}
    >
      {dl.label}
      {priority === 'critical' && <Badge tone="critical">КРИТ</Badge>}
    </span>
  );
}

// ── TaskCompetencies ───────────────────────────────────────
export function TaskCompetencies({
  competencies, userCompetencies,
}: {
  competencies: string[];
  userCompetencies?: string[];
}): ReactElement {
  if (competencies.length === 0) {
    return <span style={{ color: colors.textMuted }}>—</span>;
  }
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {competencies.map((c) => {
        const missing =
          userCompetencies && !userCompetencies.includes(c);
        return (
          <span
            key={c}
            style={{
              fontSize: fontSize.xs,
              padding: '1px 6px',
              borderRadius: radius.sm,
              background: missing
                ? 'rgba(239,68,68,0.1)'
                : colors.bg,
              color: missing ? colors.danger : colors.text,
              border: `1px solid ${missing ? colors.danger : colors.borderSoft}`,
            }}
          >
            {c}
          </span>
        );
      })}
    </span>
  );
}

// ── TaskCard ───────────────────────────────────────────────
export interface TaskCardProps {
  task: Task;
  variant?: 'compact' | 'full';
  showActions?: boolean;
  onTake?: () => void;
  onSubmit?: () => void;
  userCompetencies?: string[];
}

export function TaskCard({
  task,
  variant = 'full',
  showActions = false,
  onTake,
  onSubmit,
  userCompetencies,
}: TaskCardProps): ReactElement {
  const isCompact = variant === 'compact';

  const title = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <code
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: fontSize.xs,
          color: colors.textDim,
          background: colors.bg,
          padding: '2px 6px',
          borderRadius: radius.sm,
        }}
      >
        {task.externalId}
      </code>
      <Badge tone={PRIORITY_TONE[task.priority]}>
        {PRIORITY_LABEL[task.priority]}
      </Badge>
      <TaskStatusBadge status={task.status} />
      {task.status === 'returned' && (
        <Badge tone="danger">Требует переделки</Badge>
      )}
      {task.inDailyPlan && <Badge tone="info">В дневном плане</Badge>}
    </div>
  );

  const actions = showActions && (
    <div style={{ display: 'flex', gap: spacing.sm }}>
      {task.status === 'assigned' && onTake && (
        <Button size="sm" onClick={onTake}>
          Взять
        </Button>
      )}
      {task.status === 'returned' && onTake && (
        <Button size="sm" onClick={onTake}>
          Взять снова
        </Button>
      )}
      {task.status === 'in_progress' && onSubmit && (
        <Button size="sm" onClick={onSubmit}>
          Сдать
        </Button>
      )}
    </div>
  );

  if (isCompact) {
    return (
      <Card title={title}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            fontSize: fontSize.sm,
            color: colors.text,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {task.description}
          </span>
          <TaskDeadlineTimer
            deadline={task.deadline}
            priority={task.priority}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title={title} actions={actions || undefined}>
      {task.status === 'returned' && task.returnReason && (
        <div
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderLeft: `3px solid ${colors.danger}`,
            padding: '10px 12px',
            marginBottom: spacing.md,
            borderRadius: radius.sm,
          }}
        >
          <div
            style={{
              fontSize: fontSize.xs,
              color: colors.danger,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Возвращена ОТК
          </div>
          <div style={{ fontSize: fontSize.sm, color: colors.text }}>
            {task.returnReason}
          </div>
          {task.returnedAt && (
            <div
              style={{
                fontSize: fontSize.xs,
                color: colors.textDim,
                marginTop: 6,
              }}
            >
              {formatDateTime(task.returnedAt)}
            </div>
          )}
        </div>
      )}

      {task.planExpectedResult && (
        <div
          style={{
            background: 'rgba(59,130,246,0.08)',
            borderLeft: `3px solid ${colors.primary}`,
            padding: '8px 12px',
            marginBottom: spacing.md,
            borderRadius: radius.sm,
          }}
        >
          <div
            style={{
              fontSize: fontSize.xs,
              color: colors.primary,
              textTransform: 'uppercase',
            }}
          >
            Цель
          </div>
          <div style={{ fontSize: fontSize.sm, color: colors.text }}>
            {task.planExpectedResult}
          </div>
        </div>
      )}

      <div
        style={{
          fontSize: fontSize.sm,
          color: colors.text,
          lineHeight: 1.5,
          marginBottom: spacing.md,
        }}
      >
        {task.description}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: fontSize.xs,
        }}
      >
        {task.planTitle && (
          <div>
            <span style={{ color: colors.textDim }}>План:</span>{' '}
            {task.planTitle}
          </div>
        )}
        {task.assignerName && (
          <div>
            <span style={{ color: colors.textDim }}>От:</span>{' '}
            {task.assignerName}
            {task.assignerExternalId && (
              <span style={{ color: colors.textDim }}>
                {' '}
                ({task.assignerExternalId})
              </span>
            )}
          </div>
        )}
        <div>
          <span style={{ color: colors.textDim }}>Дедлайн:</span>{' '}
          <TaskDeadlineTimer
            deadline={task.deadline}
            priority={task.priority}
          />
        </div>
        {task.requiredCompetencies.length > 0 && (
          <div>
            <span style={{ color: colors.textDim }}>
              Компетенции:
            </span>{' '}
            <TaskCompetencies
              competencies={task.requiredCompetencies}
              userCompetencies={userCompetencies}
            />
          </div>
        )}
      </div>
    </Card>
  );
}