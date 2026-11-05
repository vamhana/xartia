// F.4.10.09 — Страница профиля задачи (Фаза 3a). Тонкая обёртка.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { TaskProfilePanel } from '../components/passport/TaskProfilePanel';
import { MatchingPanel } from '../components/passport/MatchingPanel';
import { colors, spacing } from '../theme';

export function TaskProfilePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <div style={{ color: colors.danger }}>taskId missing</div>;
  }
  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: spacing.md }}>
      <h1 style={{ margin: 0 }}>Профиль задачи</h1>
      <TaskProfilePanel taskId={id} />
      <MatchingPanel taskId={id} />
    </div>
  );
}