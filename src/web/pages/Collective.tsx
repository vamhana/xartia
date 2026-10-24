// F.4.02.29 — «Коллектив»: кто здесь, на чём и что происходит.
//
// Зачем: приглашённый должен понять, куда попал, за 30 секунд. Экран отвечает
// на три вопроса: кто есть (люди и роли), где работа идёт (направления),
// что было в последние дни (лента из audit_log).
//
// Данные: GET /collective (A.1.40.01). Персональных данных нет — только ID,
// имя, статус, направление, роли и события.

import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';
import type { ReactElement } from 'react';

interface Person {
  id: string;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: string;
  direction: { number: number; name: string } | null;
  roles: Array<{ name: string; validTo: string | null }>;
}

interface DirectionRow {
  number: number;
  name: string;
  people: number;
}

interface RoleRow {
  name: string;
  holders: number;
}

interface ActivityItem {
  id: string;
  at: string;
  actor: { externalId: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string;
}

interface Overview {
  totals: {
    people: number;
    directions: number;
    tasksInWork: number;
    reportsWaitingOtc: number;
  };
  people: Person[];
  directions: DirectionRow[];
  roles: RoleRow[];
  activity: ActivityItem[];
}

const STATUS_LABEL: Record<string, string> = {
  compatible: 'совместим',
  conditionally_compatible: 'условно',
  associated: 'ассоциирован',
  full: 'полный',
  paused: 'пауза',
  outside_trust_network: 'вне сети',
  master: 'мастер',
  integrator: 'интегратор',
  pioneer: 'пионер',
  excluded: 'отчуждён',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  master: 'master',
  full: 'success',
  compatible: 'success',
  associated: 'info',
  conditionally_compatible: 'warning',
  paused: 'warning',
  outside_trust_network: 'danger',
  excluded: 'danger',
};

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'вошёл в систему',
  'auth.logout': 'вышел',
  'auth.register': 'подал заявку',
  'tasks.create': 'создал задачу',
  'tasks.assign': 'назначил задачу',
  'tasks.take': 'взял задачу',
  'tasks.submit': 'сдал задачу',
  'tasks.accept': 'принял задачу',
  'tasks.return': 'вернул задачу',
  'reports.create': 'сдал отчёт',
  'plans.create': 'создал план',
  'plans.approve': 'утвердил план',
  'participants.create': 'принял участника',
  'participants.update_profile': 'обновил профиль',
  'otc.decision': 'решение ОТК',
  'flows.charge': 'начислил Поток',
  'signals.create': 'создал сигнал',
  'chat.message': 'написал в чат',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function entityLabel(type: string): string {
  const map: Record<string, string> = {
    participant: 'участник',
    task: 'задача',
    report: 'отчёт',
    plan: 'план',
    signal: 'сигнал',
    decision: 'решение',
    chat_message: 'сообщение',
  };
  return map[type] ?? type;
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mi}`;
}

export function CollectivePage(): ReactElement {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useApiQuery<Overview>(['collective'], '/collective');

  if (isLoading) {return <Spinner label="Собираем коллектив…" />;}
  if (isError) {
    return (
      <Card title="Ошибка">
        <div style={{ color: colors.danger }}>
          Не удалось загрузить: {error?.message ?? 'неизвестно'}
        </div>
      </Card>
    );
  }
  if (!data) {return <Spinner />;}

  const maxPeople = Math.max(1, ...data.directions.map((d) => d.people));

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Коллектив</h1>
          <p style={styles.subtitle}>
            Кто здесь, на чём работает и что происходило в последние дни
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} loading={isFetching}>
          Обновить
        </Button>
      </header>

      <div style={styles.totals}>
        <Total label="участников" value={data.totals.people} />
        <Total label="направлений" value={data.totals.directions} />
        <Total label="задач в работе" value={data.totals.tasksInWork} />
        <Total label="ждут ОТК" value={data.totals.reportsWaitingOtc} />
      </div>

      <Card title="Люди" subtitle={`${data.people.length} · роли выдаются мандатом и истекают`}>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Имя</th>
                <th style={styles.th}>Направление</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Роли</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} style={styles.tr}>
                  <td style={styles.td}><code style={styles.code}>{p.externalId}</code></td>
                  <td style={styles.td}>
                    {p.name}
                    {p.pseudonym ? <span style={styles.muted}> · {p.pseudonym}</span> : null}
                  </td>
                  <td style={styles.td}>
                    {p.direction ? `${p.direction.number}. ${p.direction.name}` : '—'}
                  </td>
                  <td style={styles.td}>
                    <Badge tone={STATUS_TONE[p.status] ?? 'default'}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </td>
                  <td style={styles.td}>
                    {p.roles.length === 0
                      ? <span style={styles.muted}>—</span>
                      : (
                        <div style={styles.chips}>
                          {p.roles.map((r, i) => (
                            <Badge key={i} tone={r.name === 'FIRST_ARCHITECT' ? 'master' : 'info'}>
                              {r.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={styles.twoCols}>
        <Card title="Направления" subtitle="сколько людей в каждом">
          <div style={styles.bars}>
            {data.directions.map((d) => (
              <div key={d.number} style={styles.barRow}>
                <span style={styles.barLabel} title={d.name}>
                  {d.number}. {d.name}
                </span>
                <div style={styles.barTrack}>
                  <div
                    style={{
                      ...styles.barFill,
                      width: `${Math.round((d.people / maxPeople) * 100)}%`,
                      opacity: d.people === 0 ? 0.25 : 1,
                    }}
                  />
                </div>
                <span style={styles.barValue}>{d.people}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Роли" subtitle="активные мандаты по типам">
          {data.roles.length === 0 ? (
            <p style={styles.muted}>Пока никому не выдан ни один мандат.</p>
          ) : (
            <div style={styles.chips}>
              {data.roles.map((r) => (
                <span key={r.name} style={styles.roleChip}>
                  <Badge tone="info">{r.name}</Badge>
                  <span style={styles.roleCount}>{r.holders}</span>
                </span>
              ))}
            </div>
          )}
          <p style={styles.hint}>
            Роль — временная функция. Когда мандат истекает, человек возвращается
            к обычной работе — это не понижение.
          </p>
        </Card>
      </div>

      <Card title="Что происходит" subtitle="события из журнала действий">
        {data.activity.length === 0 ? (
          <p style={styles.muted}>Событий пока нет.</p>
        ) : (
          <ul style={styles.feed}>
            {data.activity.map((a) => (
              <li key={a.id} style={styles.feedItem}>
                <span style={styles.feedTime}>{formatAt(a.at)}</span>
                <span style={styles.feedActor}>
                  {a.actor ? a.actor.name : 'система'}
                </span>
                <span style={styles.feedAction}>{actionLabel(a.action)}</span>
                <span style={styles.muted}>{entityLabel(a.entityType)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div style={styles.total}>
      <div style={styles.totalValue}>{value}</div>
      <div style={styles.totalLabel}>{label}</div>
    </div>
  );
}

export default CollectivePage;

const styles = {
  page: { maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  subtitle: { margin: '6px 0 0', color: colors.textMuted, fontSize: fontSize.sm } as const,
  totals: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: spacing.md,
  } as const,
  total: {
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    padding: spacing.md,
  } as const,
  totalValue: { fontSize: 24, fontWeight: 600, color: colors.text } as const,
  totalLabel: { fontSize: fontSize.xs, color: colors.textDim, marginTop: 4 } as const,
  tableWrap: { overflowX: 'auto' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm } as const,
  th: {
    textAlign: 'left', padding: `${spacing.sm}px`, borderBottom: `1px solid ${colors.border}`,
    color: colors.textMuted, fontWeight: 500, whiteSpace: 'nowrap',
  } as const,
  tr: { borderBottom: `1px solid ${colors.borderSoft}` } as const,
  td: { padding: spacing.sm, color: colors.text, verticalAlign: 'top' } as const,
  code: {
    fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs,
    background: colors.bg, padding: '2px 6px', borderRadius: 4,
  } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 } as const,
  roleChip: { display: 'flex', alignItems: 'center', gap: 6 } as const,
  roleCount: { color: colors.textMuted, fontSize: fontSize.xs } as const,
  twoCols: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: spacing.md,
  } as const,
  bars: { display: 'flex', flexDirection: 'column', gap: 6 } as const,
  barRow: { display: 'grid', gridTemplateColumns: '1fr 100px 28px', gap: spacing.sm, alignItems: 'center' } as const,
  barLabel: {
    color: colors.text, fontSize: fontSize.xs, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  } as const,
  barTrack: {
    height: 6, background: colors.bg, borderRadius: 3, overflow: 'hidden',
  } as const,
  barFill: { height: '100%', background: colors.primary, borderRadius: 3 } as const,
  barValue: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right' as const } as const,
  feed: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 } as const,
  feedItem: {
    display: 'grid', gridTemplateColumns: '82px 1fr auto auto', gap: spacing.sm,
    alignItems: 'baseline', fontSize: fontSize.sm, color: colors.text,
    paddingBottom: 6, borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  feedTime: { color: colors.textDim, fontSize: fontSize.xs } as const,
  feedActor: { fontWeight: 500 } as const,
  feedAction: { color: colors.textMuted } as const,
  hint: { marginTop: spacing.sm, color: colors.textDim, fontSize: fontSize.xs } as const,
};
