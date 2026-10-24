// F.4.04.11 — Admin: заявки на регистрацию (онбординг).
//
// Закрывает контур «пригласить человека»: заявка → решение Архитектора →
// участник с external_id и временным паролем.
//
// API: A.1.35.01
//   GET  /admin/registration-requests?statuses=new
//   POST /admin/registration-requests/:request_id/accept
//
// Временный пароль показывается ОДИН раз: в БД лежит только argon2-хеш.
// Передайте его человеку лично или через мессенджер, указанный в заявке.

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { apiGet, apiPost } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { colors, fontSize, radius, spacing } from '../../theme';

interface RegistrationRequest {
  id: string;
  status: string;
  phoneMasked: string;
  messengers: Record<string, string>;
  assignedTo: string | null;
  interviewAt: string | null;
  notes: string | null;
  consentVideo: boolean;
  consentData: boolean;
  createdAt: string;
}

interface Direction {
  id: string;
  number: number;
  name: string;
}

interface AcceptedParticipant {
  externalId: string;
  name: string;
}

interface AcceptResponse {
  participant: AcceptedParticipant;
  temporary_password: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'новая',
  interview_scheduled: 'интервью',
  decided: 'решение',
  accepted: 'принята',
  conditionally_accepted: 'условно',
  rejected: 'отклонена',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function messengersText(m: Record<string, string>): string {
  const entries = Object.entries(m ?? {});
  if (entries.length === 0) {return '—';}
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

export function RequestsPage(): ReactElement {
  const [items, setItems] = useState<RegistrationRequest[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptResponse | null>(null);

  // Черновик формы: одна карточка на выбранную заявку.
  const [form, setForm] = useState<{ id: string; name: string; directionId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queue, dirs] = await Promise.all([
        apiGet<{ data: RegistrationRequest[]; meta: { total: number } }>(
          '/admin/registration-requests',
          { statuses: 'new,interview_scheduled,decided' },
        ),
        apiGet<{ data: Direction[] }>('/directions'),
      ]);
      setItems(queue.data);
      setDirections(dirs.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (request: RegistrationRequest): Promise<void> => {
    if (!form || form.id !== request.id) {return;}
    if (form.name.trim().length < 2) {
      setError('Имя — минимум 2 символа');
      return;
    }
    if (!form.directionId) {
      setError('Выберите направление');
      return;
    }
    setBusyId(request.id);
    setError(null);
    try {
      const result = await apiPost<AcceptResponse>(
        `/admin/registration-requests/${request.id}/accept`,
        { name: form.name.trim(), direction_id: form.directionId },
      );
      setAccepted(result);
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять заявку');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Заявки</h1>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          Обновить
        </Button>
      </header>

      {error && <div style={styles.error}>{error}</div>}

      {accepted && (
        <Card
          title="Участник создан"
          subtitle="Временный пароль показывается один раз — передайте его человеку"
          variant="outlined"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setAccepted(null)}>
              Закрыть
            </Button>
          }
        >
          <div style={styles.acceptedRow}>
            <span style={styles.acceptedLabel}>ID</span>
            <code style={styles.code}>{accepted.participant.externalId}</code>
            <span style={styles.acceptedLabel}>Имя</span>
            <span>{accepted.participant.name}</span>
          </div>
          <div style={styles.acceptedRow}>
            <span style={styles.acceptedLabel}>Пароль</span>
            <code style={styles.code}>{accepted.temporary_password}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(accepted.temporary_password)}
            >
              Скопировать
            </Button>
          </div>
          <p style={styles.muted}>
            Войти можно по телефону из заявки и этому паролю. Сменить пароль —
            через «Восстановление доступа» на странице входа.
          </p>
        </Card>
      )}

      <Card
        title="Ждут решения"
        subtitle={loading ? 'загрузка…' : `всего: ${items.length}`}
      >
        {items.length === 0 && !loading ? (
          <p style={styles.muted}>
            Новых заявок нет. Человек попадает сюда после регистрации на
            странице <code style={styles.code}>/register</code>.
          </p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Телефон</th>
                <th style={styles.th}>Мессенджеры</th>
                <th style={styles.th}>Согласия</th>
                <th style={styles.th}>Подана</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Решение</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const isOpen = form?.id === r.id;
                return (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.td}>
                      <code style={styles.code}>{r.phoneMasked}</code>
                    </td>
                    <td style={styles.td}>{messengersText(r.messengers)}</td>
                    <td style={styles.td}>
                      {r.consentVideo && r.consentData ? 'видео + данные' : '—'}
                    </td>
                    <td style={styles.td}>{formatDate(r.createdAt)}</td>
                    <td style={styles.td}>{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td style={styles.td}>
                      {isOpen ? (
                        <div style={styles.acceptForm}>
                          <input
                            style={styles.input}
                            placeholder="Имя участника"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                          />
                          <select
                            style={styles.input}
                            value={form.directionId}
                            onChange={(e) => setForm({ ...form, directionId: e.target.value })}
                          >
                            <option value="">— направление —</option>
                            {directions.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.number}. {d.name}
                              </option>
                            ))}
                          </select>
                          <div style={styles.acceptButtons}>
                            <Button
                              size="sm"
                              loading={busyId === r.id}
                              onClick={() => void accept(r)}
                            >
                              Принять
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
                              Отмена
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setForm({ id: r.id, name: '', directionId: '' })}
                        >
                          Рассмотреть
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default RequestsPage;

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.sm } as const,
  error: {
    background: colors.bgSoft,
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderRadius: radius.md,
    fontSize: fontSize.sm,
  } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm } as const,
  th: {
    textAlign: 'left',
    padding: `${spacing.sm}px`,
    borderBottom: `1px solid ${colors.border}`,
    color: colors.textMuted,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  } as const,
  tr: { borderBottom: `1px solid ${colors.borderSoft}` } as const,
  td: { padding: spacing.sm, color: colors.text, verticalAlign: 'top' } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bgSoft,
    padding: '2px 6px',
    borderRadius: 4,
  } as const,
  acceptedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  } as const,
  acceptedLabel: { color: colors.textMuted, fontSize: fontSize.sm, minWidth: 64 } as const,
  acceptForm: { display: 'flex', flexDirection: 'column', gap: spacing.sm, minWidth: 220 } as const,
  acceptButtons: { display: 'flex', gap: spacing.sm } as const,
  input: {
    padding: '6px 8px',
    borderRadius: radius.md,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  } as const,
};
