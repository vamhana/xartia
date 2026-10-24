// src/web/pages/auth/WaitingRoom.tsx
/**
 * F.4.01.04 — WaitingRoom page.
 *
 * Статус заявки + таймер + WS-подписка на interview:<request_id>.
 * При accepted → /passport через 5 сек.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import type { BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { VideoCall } from '../../components/ui/VideoCall';
import { colors, fontSize, spacing } from '../../theme';
import { subscribe } from '../../ws/client';

// ─── Типы ────────────────────────────────────────────────────────

interface RegistrationStatus {
  request_id: string;
  status:
    | 'new'
    | 'interview_scheduled'
    | 'decided'
    | 'accepted'
    | 'conditionally_accepted'
    | 'rejected';
  interview_at: string | null;
  audit_id: string;
}

const STATUS_LABEL: Record<RegistrationStatus['status'], string> = {
  new: 'Заявка принята',
  interview_scheduled: 'Назначено интервью',
  decided: 'Решение принято',
  accepted: 'Принят в Хартию',
  conditionally_accepted: 'Принят условно',
  rejected: 'Заявка отклонена',
};

const STATUS_TONE: Record<RegistrationStatus['status'], BadgeTone> = {
  new: 'info',
  interview_scheduled: 'high',
  decided: 'warning',
  accepted: 'success',
  conditionally_accepted: 'warning',
  rejected: 'danger',
};

// ─── Компонент ───────────────────────────────────────────────────

export function WaitingRoomPage(): ReactElement {
  const { request_id } = useParams<{ request_id: string }>();
  const navigate = useNavigate();
  const [livePing, setLivePing] = useState(0);
  const [showVideo, setShowVideo] = useState(false);

  const query = useQuery<RegistrationStatus>({
    queryKey: ['registration', request_id, livePing],
    queryFn: () =>
      apiGet<RegistrationStatus>(`/auth/status/${request_id}`),
    enabled: Boolean(request_id),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  // WS-подписка на канал interview:<request_id>
  useEffect(() => {
    if (!request_id) {return;}
    const unsub = subscribe(`interview:${request_id}`, () => {
      // любое событие — форсим refetch
      setLivePing((v) => v + 1);
    });
    return unsub;
  }, [request_id]);

  // Авто-переход при accepted
  useEffect(() => {
    if (query.data?.status === 'accepted') {
      const t = setTimeout(
        () => navigate('/passport', { replace: true }),
        5000,
      );
      return () => clearTimeout(t);
    }
    return undefined;
  }, [query.data?.status, navigate]);

  if (!request_id) {
    return (
      <div style={styles.page}>
        <Card title="Ошибка">
          <p style={styles.muted}>Не указан request_id в URL</p>
          <Link to="/login" style={styles.link}>
            Вернуться к входу
          </Link>
        </Card>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div style={styles.page}>
        <Spinner label="Загружаем статус заявки…" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div style={styles.page}>
        <Card title="Ошибка">
          <p style={styles.muted}>
            Не удалось загрузить статус. Проверьте ссылку или повторите позже.
          </p>
          <Link to="/login" style={styles.link}>
            Вернуться к входу
          </Link>
        </Card>
      </div>
    );
  }

  const { status, interview_at } = query.data;

  return (
    <div style={styles.page}>
      <Card
        title="Комната ожидания"
        subtitle={`Заявка ${request_id.slice(0, 8)}…`}
      >
        <div style={styles.row}>
          <span style={styles.label}>Статус:</span>
          <Badge tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}
          </Badge>
        </div>

        {status === 'interview_scheduled' && interview_at ? (
          <div style={styles.block}>
            <div style={styles.blockTitle}>Интервью назначено</div>
            <div style={styles.blockText}>
              {new Date(interview_at).toLocaleString('ru-RU')}
            </div>
            <Button
              variant="primary"
              onClick={() => setShowVideo(true)}
              disabled={!request_id}
            >
              Присоединиться к интервью
            </Button>
          </div>
        ) : null}

        {status === 'accepted' ? (
          <div style={styles.blockSuccess}>
            <div style={styles.blockTitle}>Добро пожаловать!</div>
            <div style={styles.blockText}>
              Переходим в паспорт через 5 секунд…
            </div>
          </div>
        ) : null}

        {status === 'conditionally_accepted' ? (
          <div style={styles.blockWarn}>
            <div style={styles.blockTitle}>Принят условно</div>
            <div style={styles.blockText}>
              Проверьте условия интервью. Свяжитесь с СИ для уточнений.
            </div>
          </div>
        ) : null}

        {status === 'rejected' ? (
          <div style={styles.blockDanger}>
            <div style={styles.blockTitle}>Заявка отклонена</div>
            <div style={styles.blockText}>
              Повторная заявка возможна через 3 года (I.1.0.3).
            </div>
          </div>
        ) : null}

        {status === 'new' || status === 'decided' ? (
          <p style={styles.muted}>
            Мы уведомим вас, как только статус изменится.
            Автообновление каждые 30 секунд.
          </p>
        ) : null}

        <div style={styles.footer}>
          <Link to="/login" style={styles.link}>
            Вернуться к входу
          </Link>
        </div>
      </Card>

      {showVideo && request_id && (
        <VideoCall
          interviewId={request_id}
          role="candidate"
          onEnd={() => setShowVideo(false)}
        />
      )}
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.lg,
    background: colors.bg,
  },
  row: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  block: {
    padding: spacing.md,
    background: colors.bgInput,
    borderRadius: 8,
    marginBottom: spacing.md,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  blockSuccess: {
    padding: spacing.md,
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  blockWarn: {
    padding: spacing.md,
    background: 'rgba(234,179,8,0.08)',
    border: '1px solid rgba(234,179,8,0.3)',
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  blockDanger: {
    padding: spacing.md,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  blockTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 600,
  },
  blockText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  footer: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
    textAlign: 'center' as const,
  },
  link: {
    color: colors.primary,
    textDecoration: 'none',
    fontSize: fontSize.sm,
  },
};