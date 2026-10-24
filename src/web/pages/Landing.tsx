// F.4.02.30 — Публичная витрина (/ для неавторизованных).
//
// Зачем: приглашение по ссылке должно открываться объяснением, а не формой
// логина. Здесь: что это, живые цифры, как вступить, кнопки «Подать заявку»
// и «Войти».
//
// Данные: GET /public/overview (A.1.38.01) — только агрегаты, без людей.

import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { colors, fontSize, radius, spacing } from '../theme';

interface PublicOverview {
  people: number;
  directions: number;
  tasksInWork: number;
  tasksAccepted: number;
  reportsSubmitted: number;
}

const FALLBACK: PublicOverview = {
  people: 0, directions: 17, tasksInWork: 0, tasksAccepted: 0, reportsSubmitted: 0,
};

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/__api';

export function LandingPage(): ReactElement {
  const [stats, setStats] = useState<PublicOverview>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/public/overview`)
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .then((data: PublicOverview) => {
        if (alive) {
          setStats(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) { setLoaded(true); }
      });
    return () => { alive = false; };
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brand}>XartIA</div>
        <nav style={styles.nav}>
          <Link to="/login" style={styles.navLink}>Войти</Link>
          <Link to="/register" style={styles.navCta}>Подать заявку</Link>
        </nav>
      </header>

      <main style={styles.main}>
        <section style={styles.hero}>
          <h1 style={styles.h1}>
            Система, в которой работает человек,<br />а не должность
          </h1>
          <p style={styles.lead}>
            Мы собираем коллектив программистов, который строит собственный
            продукт и продаёт его наружу. Вклад — это код, а не отчёт о
            занятости: задачи, ревью и Потоки видны всем, роли выдаются
            мандатом и истекают.
          </p>

          <div style={styles.actions}>
            <Link to="/register" style={styles.primary}>
              <Button>Подать заявку</Button>
            </Link>
            <Link to="/login" style={styles.secondary}>
              <Button variant="secondary">У меня уже есть доступ</Button>
            </Link>
          </div>

          <p style={styles.note}>
            Заявка — это не анкета в пустоту: её рассматривает живой человек,
            а после приёма вы сразу получаете роль и первую задачу.
          </p>
        </section>

        <section style={styles.metrics} aria-label="Живые цифры проекта">
          <Metric value={stats.people} label="участников" />
          <Metric value={stats.directions} label="направлений" />
          <Metric value={stats.tasksInWork} label="задач в работе" />
          <Metric value={stats.tasksAccepted} label="задач принято" />
          <Metric value={stats.reportsSubmitted} label="отчётов сдано" />
        </section>
        {!loaded && <p style={styles.dim}>Загружаем цифры…</p>}

        <section style={styles.steps}>
          <h2 style={styles.h2}>Как попасть в коллектив</h2>
          <ol style={styles.list}>
            <li style={styles.step}>
              <span style={styles.stepNum}>1</span>
              <div>
                <div style={styles.stepTitle}>Заявка</div>
                <div style={styles.stepText}>
                  Телефон и мессенджер — этого достаточно. Пароль вы задаёте сами.
                </div>
              </div>
            </li>
            <li style={styles.step}>
              <span style={styles.stepNum}>2</span>
              <div>
                <div style={styles.stepTitle}>Разговор и приём</div>
                <div style={styles.stepText}>
                  Архитектор смотрит заявку, обсуждает с вами направление и роль.
                  Приём — в два клика, без бюрократии.
                </div>
              </div>
            </li>
            <li style={styles.step}>
              <span style={styles.stepNum}>3</span>
              <div>
                <div style={styles.stepTitle}>Первый день</div>
                <div style={styles.stepText}>
                  Вы получаете ID, роль и задачу «Первый день»: Хартия,
                  окружение, знакомство, первая работа.
                </div>
              </div>
            </li>
          </ol>
        </section>

        <section style={styles.principles}>
          <h2 style={styles.h2}>На чём это стоит</h2>
          <div style={styles.cards}>
            <Principle
              title="Прозрачность"
              text="Люди, роли и события видны всем участникам. Нет «теневой» части проекта."
            />
            <Principle
              title="Мандат, а не должность"
              text="Любая функция временная. Истёк мандат — человек вернулся к работе, а не потерял статус."
            />
            <Principle
              title="Ошибка — не наказание"
              text="Сбой при соблюдении процедуры — сигнал улучшить систему, а не повод для санкций."
            />
            <Principle
              title="Поток — счётчик вклада"
              text="Потоки считают сделанное, но не являются деньгами и не покупают базовые блага."
            />
          </div>
        </section>
      </main>

      <footer style={styles.footer}>
        <span style={styles.dim}>
          XartIA · Хартия 5.0 · продукт v0.1
        </span>
        <Link to="/register" style={styles.navLink}>Подать заявку</Link>
      </footer>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }): ReactElement {
  return (
    <div style={styles.metric}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

function Principle({ title, text }: { title: string; text: string }): ReactElement {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardText}>{text}</div>
    </div>
  );
}

export default LandingPage;

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
  } as const,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md}px ${spacing.xl ?? 32}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  brand: { fontSize: 20, fontWeight: 700, letterSpacing: 1 } as const,
  nav: { display: 'flex', alignItems: 'center', gap: spacing.lg ?? 24 } as const,
  navLink: { color: colors.textMuted, textDecoration: 'none', fontSize: fontSize.sm } as const,
  navCta: {
    color: colors.text,
    textDecoration: 'none',
    fontSize: fontSize.sm,
    border: `1px solid ${colors.border}`,
    padding: `6px ${spacing.md}px`,
    borderRadius: radius.md,
  } as const,
  main: {
    flex: 1,
    width: '100%',
    maxWidth: 980,
    margin: '0 auto',
    padding: `${spacing.xl ?? 48}px ${spacing.lg ?? 24}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xl ?? 48,
  } as const,
  hero: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  h1: { margin: 0, fontSize: 40, lineHeight: 1.15, fontWeight: 700 } as const,
  lead: { margin: 0, fontSize: 17, lineHeight: 1.6, color: colors.textMuted, maxWidth: 720 } as const,
  actions: { display: 'flex', gap: spacing.md, marginTop: spacing.sm } as const,
  primary: { textDecoration: 'none' } as const,
  secondary: { textDecoration: 'none' } as const,
  note: { margin: 0, fontSize: fontSize.sm, color: colors.textDim } as const,
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: spacing.md,
    borderTop: `1px solid ${colors.borderSoft}`,
    borderBottom: `1px solid ${colors.borderSoft}`,
    padding: `${spacing.lg ?? 24}px 0`,
  } as const,
  metric: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  metricValue: { fontSize: 30, fontWeight: 700 } as const,
  metricLabel: { fontSize: fontSize.xs, color: colors.textDim, textTransform: 'uppercase' as const, letterSpacing: 0.5 } as const,
  steps: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  h2: { margin: 0, fontSize: 24, fontWeight: 600 } as const,
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  step: { display: 'flex', gap: spacing.md, alignItems: 'flex-start' } as const,
  stepNum: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSize.sm,
  } as const,
  stepTitle: { fontWeight: 600, marginBottom: 4 } as const,
  stepText: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 1.6 } as const,
  principles: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: spacing.md,
  } as const,
  card: {
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.lg,
    padding: spacing.md,
  } as const,
  cardTitle: { fontWeight: 600, marginBottom: 6 } as const,
  cardText: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 1.6 } as const,
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${spacing.md}px ${spacing.xl ?? 32}px`,
    borderTop: `1px solid ${colors.borderSoft}`,
  } as const,
  dim: { color: colors.textDim, fontSize: fontSize.xs, margin: 0 } as const,
};
