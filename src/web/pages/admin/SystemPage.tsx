// F.4.04.07 — Admin system status.
// Состояние сервисов, uptime, версия, инвалидация кэшей.
//
// NB: bootstrap / delegate / rotate / seed удалены из этой страницы,
// потому что они требуют форм с параметрами (mandate_id, successor_id,
// function, holder_id, expires_at). Эти действия делаются в своих
// разделах: delegate/rotate — в MandatesPage, seed — в SystemPage
// ниже отдельной кнопкой (без параметров, идемпотентно), bootstrap —
// только через CLI-скрипт pnpm ensure:architect (см. A.1.35.01).

import { useState } from 'react';
import type { ReactElement } from 'react';

import { apiPost, type ApiError } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';

interface SystemStatus {
  healthy: boolean;
  services: Record<string, 'ok' | 'fail'>;
  uptimeSec: number;
  version: string;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) {return `${d}д ${h}ч ${m}м`;}
  if (h > 0) {return `${h}ч ${m}м`;}
  if (m > 0) {return `${m}м ${s}с`;}
  return `${s}с`;
}

export function SystemPage(): ReactElement {
  const q = useApiQuery<SystemStatus>(['admin', 'system-status'], '/admin/system-status');
  const [invalidating, setInvalidating] = useState(false);
  const [invalidated, setInvalidated] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onInvalidate = async () => {
    setInvalidating(true);
    setError(null);
    setInvalidated(null);
    try {
      const r = await apiPost<{ invalidated: number }>('/admin/invalidate-caches');
      setInvalidated(r.invalidated);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message ?? 'Ошибка');
    } finally {
      setInvalidating(false);
    }
  };

  const onSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const r = await apiPost<{ totalInserted: number; templates: Record<string, number> }>(
        '/admin/seed',
        {},
      );
      setSeedMsg(`Seed выполнен. Вставлено записей: ${r.totalInserted}`);
    } catch (e) {
      const err = e as ApiError;
      setSeedMsg(`Ошибка seed: ${err.message ?? 'unknown'}`);
    } finally {
      setSeeding(false);
    }
  };

  if (q.isLoading) {return <Spinner label="Проверяем сервисы…" />;}
  if (q.isError || !q.data) {
    return <Card title="Ошибка"><p style={styles.error}>Не удалось получить статус.</p></Card>;
  }

  const s = q.data;
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Система</h1>
      </header>

      <div style={styles.stack}>
        <Card
          title="Состояние системы"
          actions={
            <Button
              variant="danger"
              size="sm"
              onClick={onInvalidate}
              disabled={invalidating}
            >
              {invalidating ? 'Сбрасываем…' : 'Инвалидировать кэши'}
            </Button>
          }
        >
          <div style={styles.kvList}>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Общее:</span>
              <Badge tone={s.healthy ? 'success' : 'danger'}>
                {s.healthy ? 'healthy' : 'degraded'}
              </Badge>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Версия:</span>
              <span>{s.version}</span>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Uptime:</span>
              <span>{formatUptime(s.uptimeSec)}</span>
            </div>
          </div>

          <h3 style={styles.subHeader}>Сервисы</h3>
          <div style={styles.kvList}>
            {Object.entries(s.services).map(([name, status]) => (
              <div key={name} style={styles.kv}>
                <span style={styles.kvKey}>{name}:</span>
                <Badge tone={status === 'ok' ? 'success' : 'danger'}>{status}</Badge>
              </div>
            ))}
          </div>

          {invalidated !== null && (
            <p style={styles.success}>Инвалидировано ключей: {invalidated}</p>
          )}
          {error && <p style={styles.error}>{error}</p>}
        </Card>

        <Card
          title="Seed справочников"
          subtitle="Идемпотентная «добивка» directions / roles / interview_questions / widgets / containers / rights_matrix"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={onSeed}
              disabled={seeding}
            >
              {seeding ? 'Выполняем…' : 'Запустить seed'}
            </Button>
          }
        >
          <p style={styles.muted}>
            Операция безопасна при повторном запуске: ON CONFLICT DO NOTHING
            (UNIQUE-индексы на roles и interview_questions — D.2.01.20).
            На уже засеянной БД вернёт 0.
          </p>
          {seedMsg && <p style={styles.success}>{seedMsg}</p>}
        </Card>

        <Card title="Прочее" subtitle="Действия, доступные через CLI">
          <p style={styles.muted}>
            <strong>Bootstrap первого Архитектора</strong> — только через CLI
            (курица-яйцо: API требует уже залогиненного Архитектора):
          </p>
          <pre style={styles.pre}>pnpm ensure:architect</pre>
        </Card>
      </div>
    </div>
  );
}

export default SystemPage;

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' } as const,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  h1: { fontSize: 22, fontWeight: 600, margin: 0, color: colors.text } as const,
  stack: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  error: { color: colors.danger, fontSize: fontSize.sm } as const,
  success: { color: colors.success, fontSize: fontSize.sm } as const,
  kvList: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 } as const,
  kv: { display: 'flex', alignItems: 'center', gap: 8, fontSize: fontSize.sm, color: colors.text } as const,
  kvKey: { color: colors.textMuted, minWidth: 110 } as const,
  subHeader: { fontSize: fontSize.md, fontWeight: 600, margin: '12px 0 8px', color: colors.text } as const,
  pre: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 6,
    padding: spacing.sm,
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.sm,
    color: colors.text,
    overflowX: 'auto',
  } as const,
};