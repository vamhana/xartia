// F.4.02.04 — Форма отчёта по задаче.
// Тип (photo/video/text), комментарий, медиа, геолокация.
// При отправке: POST /tasks/:id/reports → POST /tasks/:id/submit → редирект.

import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
} from '../lib/format';
import { colors, spacing, fontSize, radius } from '../theme';
import type { Task } from '../types';

type ReportType = 'photo' | 'video' | 'text';

export function ReportPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const taskQuery = useApiQuery<{ data?: Task } & Partial<Task>>(
    ['task', id ?? ''],
    `/tasks/${id ?? ''}`,
    { enabled: !!id },
  );

  const [type, setType] = useState<ReportType>('text');
  const [comment, setComment] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [artifactUrl, setArtifactUrl] = useState('');
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Task приходит как `{ ...task, audit_id }` — сам объект это сам объект, без обёртки data.
  const task = (taskQuery.data as unknown as Task | undefined) ?? null;



  const onGetGeo = (): void => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Геолокация недоступна');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeoError('Не удалось получить геолокацию'),
      { timeout: 5000 },
    );
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!id) {return;}
    if (!task || task.status !== 'in_progress') {
      setError('Отчёт можно подать только для задачи в работе');
      return;
    }
    if (type === 'text' && comment.trim().length === 0) {
      setError('Для текстового отчёта нужен комментарий');
      return;
    }
    if ((type === 'photo' || type === 'video') && mediaUrl.trim().length === 0) {
      setError('Укажите URL медиа-файла');
      return;
    }
    if (artifactUrl.trim().length > 0 && !/^https?:\/\/\S+$/i.test(artifactUrl.trim())) {
      setError('Ссылка на результат должна начинаться с http:// или https://');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Создать отчёт
      await apiPost(`/tasks/${id}/reports`, {
        type,
        ...(comment ? { comment } : {}),
        ...(mediaUrl ? { media_url: mediaUrl } : {}),
        ...(artifactUrl.trim() ? { artifact_url: artifactUrl.trim() } : {}),
        ...(geo ? { geolocation: geo } : {}),
      });

      // 2. Перевести задачу в submitted
      await apiPost(`/tasks/${id}/submit`);

      // 3. Инвалидировать и уйти
      await qc.invalidateQueries({ queryKey: ['tasks', 'my'] });
      await qc.invalidateQueries({ queryKey: ['task', id] });
      navigate('/tasks', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  if (taskQuery.isLoading) {return <Spinner label="Загрузка задачи…" />;}
  if (taskQuery.isError) {
    return (
      <Card title="Ошибка">
        <div style={{ color: colors.danger }}>{taskQuery.error?.message}</div>
      </Card>
    );
  }
  if (!task) {return <Card><div style={styles.empty}>Задача не найдена</div></Card>;}

  // Отчёт можно подать только для задачи в работе.
  if (task.status !== 'in_progress') {
    const isSubmitted = task.status === 'submitted';
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>Отчёт по задаче</h1>

        <Card
          title={
            <div style={styles.taskHeader}>
              <code style={styles.extId}>{task.externalId}</code>
              <Badge tone={TASK_STATUS_TONE[task.status]}>
                {TASK_STATUS_LABEL[task.status]}
              </Badge>
            </div>
          }
        >
          <div style={styles.desc}>{task.description}</div>
        </Card>

        <Card variant="outlined">
          <div style={{ color: colors.warning, fontSize: fontSize.sm, marginBottom: spacing.md }}>
            Отчёт можно подать только для задачи в статусе <strong>«В работе»</strong>.
            Сейчас задача в статусе: <strong>{TASK_STATUS_LABEL[task.status]}</strong>.
          </div>

          {isSubmitted && (
            <div style={{ color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.md }}>
              Задача уже сдана и находится в очереди ОТК. Дождитесь решения.
            </div>
          )}

          {task.status === 'returned' && (
            <div style={{ color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.md }}>
              Задачу вернули из ОТК. Вернитесь к списку задач и нажмите
              <strong> «Взять снова в работу»</strong>.
            </div>
          )}

          <Button variant="secondary" onClick={() => navigate('/tasks')}>
            ← Вернуться к задачам
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Отчёт по задаче</h1>

      <Card
        title={
          <div style={styles.taskHeader}>
            <code style={styles.extId}>{task.externalId}</code>
            <Badge tone={PRIORITY_TONE[task.priority]}>
              {PRIORITY_LABEL[task.priority]}
            </Badge>
            <Badge tone={TASK_STATUS_TONE[task.status]}>
              {TASK_STATUS_LABEL[task.status]}
            </Badge>
          </div>
        }
      >
        {task.planExpectedResult && (
          <div style={styles.goalBlock}>
            <div style={styles.goalLabel}>Цель</div>
            <div style={styles.goalText}>{task.planExpectedResult}</div>
          </div>
        )}
        <div style={styles.desc}>{task.description}</div>
      </Card>

      <form onSubmit={(e) => void onSubmit(e)}>
        <Card title="Содержание отчёта">
          <div style={styles.fieldGroup}>
            <div style={styles.label}>Тип отчёта</div>
            <div style={styles.radioRow}>
              {(['text', 'photo', 'video'] as const).map((t) => (
                <label key={t} style={styles.radio}>
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={type === t}
                    onChange={() => setType(t)}
                  />
                  <span style={{ marginLeft: 6 }}>
                    {t === 'text' ? 'Текст' : t === 'photo' ? 'Фото' : 'Видео'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {type === 'text' && (
            <div style={styles.fieldGroup}>
              <div style={styles.label}>Комментарий *</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={5}
                style={styles.textarea}
                placeholder="Что сделано, что проверено, какие замечания…"
                disabled={submitting}
              />
            </div>
          )}

          {(type === 'photo' || type === 'video') && (
            <>
              <div style={styles.fieldGroup}>
                <div style={styles.label}>URL медиа-файла *</div>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  style={styles.input}
                  placeholder="https://... или s3://charter-media/..."
                  disabled={submitting}
                />
                <div style={styles.hint}>
                  Загрузка файлов в S3 через presigned URL — в следующей итерации.
                  Пока укажите готовый URL.
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <div style={styles.label}>Комментарий</div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  style={styles.textarea}
                  placeholder="Дополнительные пояснения (опционально)"
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {/* Артефакт — то, что проверяет ОТК у программиста: PR, коммит, документ. */}
          <div style={styles.fieldGroup}>
            <div style={styles.label}>Ссылка на результат (PR / коммит)</div>
            <input
              type="url"
              value={artifactUrl}
              onChange={(e) => setArtifactUrl(e.target.value)}
              style={styles.input}
              placeholder="https://github.com/org/repo/pull/123"
              disabled={submitting}
            />
            <div style={styles.hint}>
              Необязательно, но без ссылки ОТК проверяет только текст.
              Коммит: <code style={styles.inlineCode}>…/commit/abc1234</code>
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <div style={styles.label}>Геолокация</div>
            {geo ? (
              <div style={styles.geoOk}>
                <code style={styles.geoCode}>
                  {geo.lat.toFixed(5)}, {geo.lon.toFixed(5)}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setGeo(null)}
                >
                  Сбросить
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onGetGeo}
              >
                Определить местоположение
              </Button>
            )}
            {geoError && <div style={styles.geoError}>{geoError}</div>}
          </div>

          {error && <div style={styles.error}>{error}</div>}
        </Card>

        <div style={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/tasks')}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button type="submit" loading={submitting}>
            Отправить отчёт
          </Button>
        </div>
      </form>
    </div>
  );
}

const styles = {
  page: { maxWidth: 720 } as const,
  h1: { margin: '0 0 16px', fontSize: 22, color: colors.text } as const,
  inlineCode: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: '1px 5px',
    borderRadius: 4,
  } as const,
  taskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  } as const,
  extId: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textDim,
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: radius.sm,
  } as const,
  goalBlock: {
    background: 'rgba(59, 130, 246, 0.08)',
    borderLeft: `3px solid ${colors.primary}`,
    padding: '8px 12px',
    marginBottom: spacing.md,
    borderRadius: radius.sm,
  } as const,
  goalLabel: {
    fontSize: fontSize.xs,
    color: colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as const,
  goalText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 1.4 } as const,
  desc: { fontSize: fontSize.sm, color: colors.text, lineHeight: 1.5 } as const,
  fieldGroup: { marginBottom: spacing.md } as const,
  label: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as const,
  radioRow: { display: 'flex', gap: spacing.lg } as const,
  radio: { display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: fontSize.sm } as const,
  input: {
    width: '100%',
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: '10px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  } as const,
  textarea: {
    width: '100%',
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: '10px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as const,
  hint: { fontSize: fontSize.xs, color: colors.textDim, marginTop: 6 } as const,
  geoOk: { display: 'flex', alignItems: 'center', gap: spacing.sm } as const,
  geoCode: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.sm,
    background: colors.bg,
    padding: '4px 8px',
    borderRadius: radius.sm,
    color: colors.success,
  } as const,
  geoError: { fontSize: fontSize.xs, color: colors.danger, marginTop: 4 } as const,
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: '8px 12px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  } as const,
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  } as const,
  empty: { color: colors.textMuted, fontSize: fontSize.sm } as const,
};