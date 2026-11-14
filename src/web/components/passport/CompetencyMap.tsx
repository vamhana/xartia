// F.4.10.06 — Карта кластеров (SVG) + табличный двойник.
// Без тяжёлых библиотек. Цвет не единственный носитель смысла:
//   * размер круга = width,
//   * толщина обводки = depthExecution,
//   * пунктирное внешнее кольцо = фантом (missing-атомы в кластере),
//   * подпись кластера + числовые значения в табличном режиме.
// aria-hidden на svg, <title> в каждой фигуре — для скринридеров.

import { useMemo, useState, type ReactElement } from 'react';

import { colors, fontSize } from '../../theme';
import type {
  PassportCatalogItem,
  PassportClusterAggregate,
  PassportGoal,
} from '../../types';
import { Card } from '../ui/Card';

import { CLUSTER_LABEL, CLUSTER_SHORT } from './clusterLabels';

const VB_W = 640;
const VB_H = 320;
const COLS = 4;
const ROWS = 2;
const CELL_W = VB_W / COLS;
const CELL_H = VB_H / ROWS;

export function CompetencyMap({
  byCluster,
  goals,
  catalog,
}: {
  byCluster: PassportClusterAggregate[];
  goals: PassportGoal[];
  catalog: PassportCatalogItem[];
}): ReactElement {
  const [mode, setMode] = useState<'table' | 'map'>('table');

  // atomId → cluster (из каталога). Если каталог ещё не загружен — пустая карта,
  // но табличный режим продолжает работать.
  const atomCluster = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of catalog) {m.set(a.atomId, a.cluster);}
    return m;
  }, [catalog]);

  // cluster → число фантомных атомов (missing) по активным целям.
  const phantomByCluster = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of goals) {
      if (g.status !== 'active') {continue;}
      for (const miss of g.missingAtoms) {
        const cluster = atomCluster.get(miss.atomId);
        if (!cluster) {continue;}
        m.set(cluster, (m.get(cluster) ?? 0) + 1);
      }
    }
    return m;
  }, [goals, atomCluster]);

  return (
    <Card
      title="Кластеры"
      subtitle={mode === 'table' ? 'табличный режим' : 'карта · размер = width, обводка = depth_exec, пунктир = фантом'}
      actions={
        <button
          onClick={() => setMode(mode === 'table' ? 'map' : 'table')}
          style={styles.toggle}
        >
          {mode === 'table' ? 'карта' : 'таблица'}
        </button>
      }
    >
      {mode === 'table' ? (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Кластер</th>
              <th style={styles.thNum}>Ширина</th>
              <th style={styles.thNum}>depth_exec</th>
              <th style={styles.thNum}>depth_und</th>
              <th style={styles.thNum}>depth_full</th>
              <th style={styles.thNum}>фантом</th>
            </tr>
          </thead>
          <tbody>
            {byCluster.map((c) => {
              const phantom = phantomByCluster.get(c.cluster) ?? 0;
              return (
                <tr key={c.cluster}>
                  <td style={styles.td}>{CLUSTER_LABEL[c.cluster] ?? c.cluster}</td>
                  <td style={styles.tdNum}>{c.width}</td>
                  <td style={styles.tdNum}>{c.depthExecution}</td>
                  <td style={styles.tdNum}>{c.depthUnderstanding}</td>
                  <td style={styles.tdNum}>{c.depthFull}</td>
                  <td style={styles.tdNum}>{phantom > 0 ? phantom : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            style={{ maxWidth: VB_W, display: 'block', margin: '0 auto' }}
            role="img"
            aria-label="Карта кластеров: размер = ширина, толщина обводки = глубина исполнения, пунктир = фантом"
            aria-hidden={false}
          >
            {byCluster.map((c, i) => {
              const col = i % COLS;
              const row = Math.floor(i / COLS);
              if (row >= ROWS) {return null;}
              const cx = col * CELL_W + CELL_W / 2;
              const cy = row * CELL_H + CELL_H / 2 - 6;

              const r = 6 + 1.2 * Math.sqrt(c.width); // 0 → 6, 54 → ~14.8
              const strokeW = 1 + 0.5 * c.depthExecution;
              const phantom = phantomByCluster.get(c.cluster) ?? 0;

              return (
                <g key={c.cluster}>
                  {phantom > 0 && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r + 5}
                      fill="none"
                      stroke={colors.textDim}
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      aria-hidden="true"
                    >
                      <title>фантом: {phantom} атомов</title>
                    </circle>
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={c.width > 0 ? colors.text : colors.bg}
                    stroke={c.width > 0 ? colors.text : colors.border}
                    strokeWidth={strokeW}
                  >
                    <title>
                      {CLUSTER_LABEL[c.cluster] ?? c.cluster}: ширина {c.width},
                      depth_exec {c.depthExecution}, depth_und {c.depthUnderstanding},
                      depth_full {c.depthFull}
                      {phantom > 0 ? `, фантом ${phantom}` : ''}
                    </title>
                  </circle>
                  <text
                    x={cx}
                    y={cy + r + 14}
                    textAnchor="middle"
                    fontSize="10"
                    fill={colors.textDim}
                    fontFamily="ui-monospace, monospace"
                  >
                    {CLUSTER_SHORT[c.cluster] ?? c.cluster}
                  </text>
                  <text
                    x={cx}
                    y={cy + r + 26}
                    textAnchor="middle"
                    fontSize="9"
                    fill={colors.textMuted}
                    fontFamily="ui-monospace, monospace"
                  >
                    w{c.width}/d{c.depthExecution}
                    {phantom > 0 ? ` · ф${phantom}` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Card>
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
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  thNum: {
    textAlign: 'right' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  tdNum: {
    padding: '4px 8px',
    fontSize: fontSize.sm,
    textAlign: 'right' as const,
    fontFamily: 'ui-monospace, monospace',
  } as const,
};