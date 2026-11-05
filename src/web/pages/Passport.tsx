// F.4.02.01 (шаг 7) — Страница Паспорт.
// Вкладки: Профиль (LegacyProfile) / Обзор / Каталог / Атом / История / Видимость.
// Старый профиль живёт в ./components/passport/LegacyProfile.tsx (ключ ['passport','me']).
// PATCH visibility — внутри VisibilityPanel.
const GraphView = lazy(() =>
  import('../components/passport/GraphView').then((m) => ({ default: m.GraphView })),
);
import { lazy, Suspense, useState, type ReactElement } from 'react';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { AtomCardView } from '../components/passport/AtomCard';
import { LegacyProfile } from '../components/passport/LegacyProfile';
import { PassportOverviewView } from '../components/passport/PassportOverview';
import { Timeline } from '../components/passport/Timeline';
import { VisibilityPanel } from '../components/passport/VisibilityPanel';
import { GrantsPanel } from '../components/passport/GrantsPanel';
import { TeachingPanel } from '../components/passport/TeachingPanel';
import { PermitsPanel } from '../components/passport/PermitsPanel';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, spacing, fontSize, radius } from '../theme';
import type {
  PassportAccessLogItem,
  PassportAtomCard,
  PassportCatalogItem,
  PassportDirectionRef,
  PassportHistoryItem,
  PassportOverview,
  PassportVisibilityState,
} from '../types';

type Tab =
  | 'profile' | 'overview' | 'catalog' | 'atom' | 'history'
  | 'visibility' | 'teaching' | 'permits' | 'graph';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'profile', label: 'Профиль' },
  { id: 'overview', label: 'Обзор' },
  { id: 'catalog', label: 'Каталог' },
  { id: 'atom', label: 'Атом' },
  { id: 'graph', label: 'Граф' },
  { id: 'history', label: 'История' },
  { id: 'visibility', label: 'Видимость' },
  { id: 'teaching', label: 'Наставничество' },
  { id: 'permits', label: 'Допуски' },
];

export function PassportPage(): ReactElement {
  const user = useUser();
  const meId = user?.participant.id ?? '';
  
  const [tab, setTab] = useState<Tab>('profile');
  const [selectedAtom, setSelectedAtom] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<number | null>(null);

  const overview = useApiQuery<PassportOverview>(['passport', 'overview'], '/passport/me');
  const visibility = useApiQuery<{ data: PassportVisibilityState[] }>(
    ['passport', 'visibility'],
    '/passport/visibility',
  );
  const accessLog = useApiQuery<{ data: PassportAccessLogItem[] }>(
    ['passport', 'access-log'],
    '/passport/access-log?limit=50',
  );
  const history = useApiQuery<{ data: PassportHistoryItem[] }>(
    ['passport', 'history'],
    '/passport/history?limit=100',
  );
  const directions = useApiQuery<{ data: PassportDirectionRef[] }>(
    ['passport', 'directions'],
    '/passport/directions',
  );
  const catalog = useApiQuery<{ data: PassportCatalogItem[]; meta: { total: number } }>(
    ['passport', 'catalog', search, direction],
    `/passport/catalog?limit=200${search ? `&query=${encodeURIComponent(search)}` : ''}${direction ? `&direction=${direction}` : ''}`,
  );

  const goAtom = (atomId: string): void => {
    setSelectedAtom(atomId);
    setTab('atom');
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>Паспорт</h1>
      </div>

      <nav style={styles.tabs} aria-label="Паспорт">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tab,
              background: tab === t.id ? colors.bg : 'transparent',
              fontWeight: tab === t.id ? 600 : 400,
              borderColor: tab === t.id ? colors.text : colors.border,
            }}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'profile' && <LegacyProfile />}

      {tab === 'overview' && (
        <>
          {overview.isLoading && <Spinner label="Загрузка обзора…" />}
          {overview.isError && (
            <Card title="Ошибка" variant="outlined">
              <div style={{ color: colors.danger }}>Не удалось загрузить обзор</div>
            </Card>
          )}
          {overview.data && (
            <PassportOverviewView
              overview={overview.data}
              catalog={catalog.data?.data ?? []}
            />
          )}
          {overview.data && (
            <Card title="Быстрый переход" subtitle="примеры атомов">
              <div style={styles.chipRow}>
                {['CYB.ATOM.0009', 'CYB.ATOM.0010', 'CYB.ATOM.0020'].map((id) => (
                  <button key={id} onClick={() => goAtom(id)} style={styles.chip}>
                    {id}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'catalog' && (
        <Card
          title="Каталог атомов"
          subtitle={catalog.data ? `найдено: ${catalog.data.meta.total}` : undefined}
          actions={
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={direction ?? ''}
                onChange={(e) =>
                  setDirection(e.target.value ? Number(e.target.value) : null)
                }
                style={styles.search}
              >
                <option value="">Все направления</option>
                {(directions.data?.data ?? []).map((d) => (
                  <option key={d.id} value={d.number}>
                    {d.number}. {d.name}
                  </option>
                ))}
              </select>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="поиск по названию или ID"
                style={styles.search}
              />
            </div>
          }
        >
          {catalog.isLoading && <Spinner label="Загрузка каталога…" />}
          {catalog.data && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Название</th>
                  <th style={styles.th}>Кластер</th>
                  <th style={styles.th}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {catalog.data.data.map((a) => (
                  <tr
                    key={a.atomId}
                    onClick={() => goAtom(a.atomId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={styles.td}><code style={styles.code}>{a.atomId}</code></td>
                    <td style={styles.td}>{a.name}</td>
                    <td style={styles.td}>{a.cluster}</td>
                    <td style={styles.td}>
                      <Badge tone="default">{a.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'atom' && (
        selectedAtom
          ? <AtomTabContent atomId={selectedAtom} />
          : (
            <Card title="Выберите атом" variant="outlined">
              <div style={{ color: colors.textMuted }}>
                Откройте «Обзор» или «Каталог» и выберите атом.
              </div>
            </Card>
          )
      )}

      {tab === 'history' && (
        <>
          {history.isLoading && <Spinner label="Загрузка истории…" />}
          {history.data && (
            <Timeline
              items={history.data.data}
              clusters={overview.data?.byCluster}
              goals={overview.data?.goals}
            />
          )}
        </>
      )}

      {tab === 'visibility' && (
        <>
          {visibility.isLoading && <Spinner label="Загрузка настроек…" />}
          {visibility.data && accessLog.data && (
            <VisibilityPanel
              states={visibility.data.data}
              accessLog={accessLog.data.data}
            />
          )}
          <GrantsPanel />
        </>
      )}
      
      {tab === 'teaching' && <TeachingPanel />}
      
      {tab === 'permits' && meId && <PermitsPanel meId={meId} />}
      {tab === 'graph' && (
        <Suspense fallback={<Spinner label="Загрузка графа…" />}>
          <GraphView
            onSelectAtom={(atomId) => {
              setSelectedAtom(atomId);
              setTab('atom');
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function AtomTabContent({ atomId }: { atomId: string }): ReactElement {
  const card = useApiQuery<PassportAtomCard>(
    ['passport', 'atom', atomId],
    `/passport/atoms/${atomId}/card`,
  );
  if (card.isLoading) return <Spinner label="Загрузка карточки…" />;
  if (card.isError) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>Не удалось загрузить атом</div>
      </Card>
    );
  }
  if (!card.data) return <Spinner />;
  return <AtomCardView card={card.data} />;
}

const styles = {
  page: { maxWidth: 1100 } as const,
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  tabs: {
    display: 'flex',
    gap: 4,
    marginBottom: spacing.md,
    flexWrap: 'wrap' as const,
  } as const,
  tab: {
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: fontSize.sm,
    color: colors.text,
  } as const,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: '1px 4px',
    borderRadius: radius.sm,
  } as const,
  search: {
    padding: '4px 8px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 260,
  } as const,
  chipRow: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap' as const } as const,
  chip: {
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    padding: '2px 8px',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: fontSize.sm,
    fontFamily: 'ui-monospace, monospace',
    color: colors.text,
  } as const,
};