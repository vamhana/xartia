// F.4.10.02 — Обзор (масштаб 1). width/depth раздельно, counts, goals, кластер-карта.

import { useState, type ReactElement } from 'react';

import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportCatalogItem,
  PassportOverview,
} from '../../types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';


import { CompetencyMap } from './CompetencyMap';

export function PassportOverviewView({
  overview,
  catalog,
}: {
  overview: PassportOverview;
  catalog: PassportCatalogItem[];
}): ReactElement {
  const [mode, setMode] = useState<'table' | 'text'>('table');

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card
        title="Обзор"
        subtitle="Ширина и глубина — независимые показатели (паспорт 6.6)"
        actions={
          <button
            onClick={() => setMode(mode === 'table' ? 'text' : 'table')}
            style={styles.toggle}
          >
            {mode === 'table' ? 'текстовый режим' : 'табличный режим'}
          </button>
        }
      >
        <div style={styles.kpiRow}>
          <Kpi label="Ширина" value={overview.width} hint="≥ 4 по всем применимым" />
          <Kpi label="Глубина: исполнение" value={overview.depthExecution} hint="P ≥ 7" />
          <Kpi label="Глубина: понимание" value={overview.depthUnderstanding} hint="U,X,D,E ≥ 7" />
          <Kpi label="Глубина: полная" value={overview.depthFull} hint="exec ∧ understanding" />
          <Kpi
            label="calibration_pending"
            value={overview.calibrationPendingAtoms}
            hint="атомы без approved-критериев"
            muted
          />
          <Kpi
            label="Устарело"
            value={overview.staleAssessments.length}
            hint="истёк practice_review_policy"
            muted
          />
        </div>
      </Card>

      <CompetencyMap
        byCluster={overview.byCluster}
        goals={overview.goals}
        catalog={catalog}
      />

      <Card title="Статусы" subtitle="по всем 54 атомам">
        {mode === 'table' ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Кол-во</th>
              </tr>
            </thead>
            <tbody>
              <CountRow label="Не оценено" value={overview.counts.notAssessed} />
              <CountRow label="Заявлено" value={overview.counts.declared} />
              <CountRow label="Подтверждено" value={overview.counts.confirmed} />
              <CountRow label="В работе" value={overview.counts.inProgress} />
              <CountRow label="Калибровка" value={overview.counts.calibrationPending} />
              <CountRow label="На пересмотре" value={overview.counts.underReview} />
              <CountRow label="Оспаривается" value={overview.counts.disputed} />
              <CountRow label="Неприменимо" value={overview.counts.notApplicable} />
            </tbody>
          </table>
        ) : (
          <ul style={styles.textList}>
            <li>Не оценено: {overview.counts.notAssessed}</li>
            <li>Заявлено: {overview.counts.declared}</li>
            <li>Подтверждено: {overview.counts.confirmed}</li>
            <li>В работе: {overview.counts.inProgress}</li>
            <li>Калибровка: {overview.counts.calibrationPending}</li>
            <li>На пересмотре: {overview.counts.underReview}</li>
            <li>Оспаривается: {overview.counts.disputed}</li>
            <li>Неприменимо: {overview.counts.notApplicable}</li>
          </ul>
        )}
      </Card>

      <Card title="Цели и маршруты" subtitle="фантомное развитие — не освоенное">
        {overview.goals.length === 0 ? (
          <div style={styles.muted}>Нет активных целей</div>
        ) : (
          <div style={{ display: 'grid', gap: spacing.sm }}>
            {overview.goals.map((g) => (
              <div key={g.id} style={{ ...styles.goal, borderStyle: 'dashed' }}>
                <div style={{ fontWeight: 600 }}>{g.goal}</div>
                <div style={styles.muted}>
                  Целевой профиль: {g.targetProfileSlug ?? '—'}
                </div>
                {g.missingAtoms.length > 0 && (
                  <ul style={styles.textList}>
                    {g.missingAtoms.slice(0, 8).map((m) => (
                      <li key={m.atomId}>
                        {m.atomId} {m.atomName} — не хватает:{' '}
                        {m.missingDimensions.join(', ')}
                        {m.alternativeAtomIds.length > 0 && (
                          <span style={styles.muted}>
                            {' '}· альтернативы: {m.alternativeAtomIds.join(', ')}
                          </span>
                        )}
                      </li>
                    ))}
                    {g.missingAtoms.length > 8 && (
                      <li style={styles.muted}>… и ещё {g.missingAtoms.length - 8}</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      
      {overview.staleAssessments.length > 0 && (
        <Card title="Устаревшие подтверждения" subtitle="не понижают уровень; §7.5">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Атом</th>
                <th style={styles.th}>Изм.</th>
                <th style={styles.th}>Политика</th>
                <th style={styles.th}>Оценено</th>
                <th style={styles.th}>Стало устаревшим</th>
              </tr>
            </thead>
            <tbody>
              {overview.staleAssessments.map((s) => (
                <tr key={`${s.atomId}:${s.dimension}`}>
                  <td style={styles.td}><code style={styles.code}>{s.atomId}</code></td>
                  <td style={styles.td}>{s.dimension}</td>
                  <td style={styles.td}>{s.policy}</td>
                  <td style={styles.td}>
                    <code style={styles.code}>{new Date(s.assessedAt).toISOString().slice(0,10)}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{new Date(s.staleSince).toISOString().slice(0,10)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}      
    </div>
  );
}

function Kpi({
  label, value, hint, muted,
}: { label: string; value: number; hint?: string; muted?: boolean }): ReactElement {
  return (
    <div style={{ ...styles.kpi, opacity: muted ? 0.7 : 1 }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      {hint && <div style={styles.kpiHint}>{hint}</div>}
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <tr>
      <td style={styles.td}>{label}</td>
      <td style={styles.tdNum}>
        <Badge tone={value > 0 ? 'info' : 'default'}>{String(value)}</Badge>
      </td>
    </tr>
  );
}

const styles = {
  toggle: {
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: fontSize.xs,
    color: colors.textDim,
  } as const,
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: spacing.sm,
  } as const,
  kpi: {
    padding: spacing.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
  } as const,
  kpiLabel: {
    fontSize: fontSize.xs, color: colors.textDim, textTransform: 'uppercase' as const,
  },
  kpiValue: { fontSize: 24, fontWeight: 600 as const, color: colors.text },
  kpiHint: { fontSize: fontSize.xs, color: colors.textMuted },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const, padding: '4px 8px',
    fontSize: fontSize.xs, color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  tdNum: {
    padding: '4px 8px', fontSize: fontSize.sm, textAlign: 'right' as const,
    fontFamily: 'ui-monospace, monospace',
  } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: '1px 4px',
    borderRadius: 3,
  } as const,
  textList: { margin: 0, paddingLeft: 16, fontSize: fontSize.sm } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  goal: {
    padding: spacing.sm,
    border: `1px dashed ${colors.border}`,
    borderRadius: 6,
  } as const,
};