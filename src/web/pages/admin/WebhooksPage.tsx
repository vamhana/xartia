// F.4.04.10 — Admin Webhooks (Deferred).
//
// Управление внешними webhook-подписками (V.6, V.7).
// Status: Deferred — UI не реализован, но маршрут заведён,
// чтобы не забыть при возврате к задачам интеграций.
//
// API уже работает (A.1.97.01) — можно управлять через curl / swagger.

import type { ReactElement } from 'react';

import { Card } from '../../components/ui/Card';
import { colors, fontSize, spacing } from '../../theme';

export function WebhooksPage(): ReactElement {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Webhooks</h1>
      </header>

      <Card
        title="Раздел в разработке"
        subtitle="Внешние интеграции (V.6, V.7)"
      >
        <p style={styles.muted}>
          API для управления webhook-подписками уже работает
          (<code style={styles.code}>A.1.97.01</code>). UI появится в
          следующей волне.
        </p>
        <p style={styles.muted}>
          Доступные эндпоинты:
        </p>
        <ul style={styles.list}>
          <li><code style={styles.code}>GET /webhooks</code> — список подписок</li>
          <li><code style={styles.code}>POST /webhooks</code> — создать</li>
          <li><code style={styles.code}>PATCH /webhooks/:id</code> — обновить</li>
          <li><code style={styles.code}>DELETE /webhooks/:id</code> — удалить</li>
          <li><code style={styles.code}>POST /webhooks/:id/test</code> — тест</li>
          <li><code style={styles.code}>GET /webhooks/:id/deliveries</code> — история</li>
          <li><code style={styles.code}>POST /webhooks/:id/retry/:delivery_id</code> — повтор</li>
          <li><code style={styles.code}>GET /webhooks/events</code> — события</li>
        </ul>
      </Card>
    </div>
  );
}

export default WebhooksPage;

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' } as const,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 0 } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bgSoft,
    padding: '2px 6px',
    borderRadius: 4,
  } as const,
  list: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.8,
    paddingLeft: 20,
  } as const,
};