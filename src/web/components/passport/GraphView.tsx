// F.4.10.23 — Граф паспорта (Фаза 3d, §8.4).
// Force-directed SVG без библиотек (54 узла × 133 ребра — O(n²) на 150 итераций
// ≈ 437k операций — мгновенно). Клик на узел → onSelectAtom.
// Обязателен табличный режим (§17.4), role="img", <title> на узлах и рёбрах.

import { useMemo, useState, type ReactElement } from 'react';

import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../../theme';
import type {
  PassportGraphNode,
  PassportGraphPayload,
} from '../../types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

const VIEWBOX_W = 900;
const VIEWBOX_H = 600;

// ─── Force-directed ─────────────────────────────────────────────────

interface Pos {
  x: number;
  y: number;
}

function layoutGraph(
  nodes: PassportGraphNode[],
  edges: PassportGraphPayload['edges'],
  width: number,
  height: number,
  iterations = 150,
): Map<string, Pos> {
  const n = nodes.length;
  const out = new Map<string, Pos>();
  if (n === 0) {return out;}

  // Детерминированный seed по индексу атома — стабильный layout между рендерами.
  const pos: Pos[] = nodes.map((_, i) => {
    const angle = (i * 2 * Math.PI) / n;
    return {
      x: width / 2 + Math.cos(angle) * (width * 0.3),
      y: height / 2 + Math.sin(angle) * (height * 0.3),
    };
  });

  const idx = new Map(nodes.map((nd, i) => [nd.atomId, i]));
  const edgePairs: Array<[number, number]> = edges
    .map((e) => {
      const a = idx.get(e.fromAtomId);
      const b = idx.get(e.toAtomId);
      return a !== undefined && b !== undefined ? ([a, b] as [number, number]) : null;
    })
    .filter((x): x is [number, number] => x !== null);

  const k = Math.sqrt((width * height) / n) * 0.7;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // Repulsion (Coulomb)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]!.x - pos[j]!.x;
        const dy = pos[i]!.y - pos[j]!.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        disp[i]!.x += (dx / dist) * force;
        disp[i]!.y += (dy / dist) * force;
        disp[j]!.x -= (dx / dist) * force;
        disp[j]!.y -= (dy / dist) * force;
      }
    }

    // Attraction (Hooke)
    for (const [a, b] of edgePairs) {
      const dx = pos[a]!.x - pos[b]!.x;
      const dy = pos[a]!.y - pos[b]!.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      disp[a]!.x -= (dx / dist) * force;
      disp[a]!.y -= (dy / dist) * force;
      disp[b]!.x += (dx / dist) * force;
      disp[b]!.y += (dy / dist) * force;
    }

    // Centering pull
    for (let i = 0; i < n; i++) {
      disp[i]!.x += (width / 2 - pos[i]!.x) * 0.01;
      disp[i]!.y += (height / 2 - pos[i]!.y) * 0.01;
    }

    // Apply with cooling
    const t = Math.max(0.05, 1 - iter / iterations) * 20;
    for (let i = 0; i < n; i++) {
      const dx = disp[i]!.x;
      const dy = disp[i]!.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      pos[i]!.x += (dx / d) * Math.min(d, t);
      pos[i]!.y += (dy / d) * Math.min(d, t);
      pos[i]!.x = Math.max(20, Math.min(width - 20, pos[i]!.x));
      pos[i]!.y = Math.max(20, Math.min(height - 20, pos[i]!.y));
    }
  }

  nodes.forEach((nd, i) => out.set(nd.atomId, pos[i]!));
  return out;
}

// ─── Узел: цвет по кластеру, размер по max(level) ───────────────────

const CLUSTER_COLOR: Record<string, string> = {
  requirements_and_computational_thinking: '#8b5cf6',
  software_development: '#3b82f6',
  data_and_databases: '#06b6d4',
  server_interfaces_and_api: '#14b8a6',
  testing_and_quality: '#f59e0b',
  software_security: '#ef4444',
  infrastructure_and_operations: '#84cc16',
};

function nodeRadius(node: PassportGraphNode): number {
  const levels = node.dimensions
    .map((d) => d.level)
    .filter((v): v is number => v !== null);
  if (levels.length === 0) {return 4;}
  const max = Math.max(...levels);
  return 4 + max * 1.2;
}

// ─── Component ──────────────────────────────────────────────────────

interface Props {
  onSelectAtom: (atomId: string) => void;
}

export function GraphView({ onSelectAtom }: Props): ReactElement {
  const [mode, setMode] = useState<'graph' | 'table'>('graph');
  const [filter, setFilter] = useState<'all' | 'assessed' | 'not_assessed'>('all');
  const [hover, setHover] = useState<string | null>(null);

  const q = useApiQuery<PassportGraphPayload>(
    ['passport', 'graph', filter],
    `/passport/graph?filter=${filter}`,
  );

  const positions = useMemo(() => {
    if (!q.data) {return new Map<string, Pos>();}
    return layoutGraph(q.data.nodes, q.data.edges, VIEWBOX_W, VIEWBOX_H);
  }, [q.data]);

  if (q.isLoading) {return <Spinner label="Загрузка графа…" />;}
  if (q.isError || !q.data) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить граф'}
        </div>
      </Card>
    );
  }

  const { nodes, edges, meta } = q.data;

  return (
    <Card
      title="Граф"
      subtitle={`${meta.totalNodes} узлов · ${meta.totalEdges} рёбер`}
      actions={
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            style={styles.select}
          >
            <option value="all">все</option>
            <option value="assessed">с оценкой</option>
            <option value="not_assessed">без оценки</option>
          </select>
          <button
            onClick={() => setMode(mode === 'graph' ? 'table' : 'graph')}
            style={styles.toggle}
          >
            {mode === 'graph' ? 'таблица' : 'граф'}
          </button>
        </div>
      }
    >
      {mode === 'table' ? (
        <GraphTable nodes={nodes} onSelectAtom={onSelectAtom} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            width="100%"
            style={{ maxWidth: VIEWBOX_W, display: 'block', margin: '0 auto' }}
            role="img"
            aria-label={`Граф паспорта: ${meta.totalNodes} узлов, ${meta.totalEdges} рёбер`}
          >
            {/* Рёбра */}
            {edges.map((e, i) => {
              const a = positions.get(e.fromAtomId);
              const b = positions.get(e.toAtomId);
              if (!a || !b) {return null;}
              const isHighlighted =
                hover === e.fromAtomId || hover === e.toAtomId;
              return (
                <line
                  key={`${e.fromAtomId}-${e.toAtomId}-${e.relationType}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={isHighlighted ? colors.primary : colors.border}
                  strokeWidth={isHighlighted ? 1.5 : 0.6}
                  strokeOpacity={isHighlighted ? 0.9 : 0.35}
                  strokeDasharray={e.relationType === 'alternative_to' ? '4 3' : undefined}
                >
                  <title>{`${e.fromAtomId} → ${e.toAtomId} (${e.relationType})`}</title>
                </line>
              );
            })}
            {/* Узлы */}
            {nodes.map((n) => {
              const p = positions.get(n.atomId);
              if (!p) {return null;}
              const r = nodeRadius(n);
              const fill = CLUSTER_COLOR[n.cluster] ?? colors.textDim;
              return (
                <g
                  key={n.atomId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectAtom(n.atomId)}
                  onMouseEnter={() => setHover(n.atomId)}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={fill}
                    fillOpacity={n.isWidth || n.isDepthFull ? 0.85 : 0.4}
                    stroke={
                      n.isDepthFull
                        ? colors.primary
                        : n.isDepthExecution || n.isDepthUnderstanding
                        ? colors.warning
                        : fill
                    }
                    strokeWidth={n.isDepthFull ? 2 : 1}
                  >
                    <title>
                      {`${n.atomId} — ${n.name}\n${n.dimensions
                        .map((d) => `${d.dimension}:${d.level ?? '∅'}`)
                        .join(' ')}`}
                    </title>
                  </circle>
                  {(n.isWidth || n.isDepthFull) && (
                    <text
                      x={p.x}
                      y={p.y - r - 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill={colors.text}
                      fontFamily="ui-monospace, monospace"
                    >
                      {n.atomId.slice(-4)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Card>
  );
}

// ─── Табличный режим ────────────────────────────────────────────────

function GraphTable({
  nodes,
  onSelectAtom,
}: {
  nodes: PassportGraphNode[];
  onSelectAtom: (atomId: string) => void;
}): ReactElement {
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Атом</th>
          <th style={styles.th}>Кластер</th>
          <th style={styles.th}>U</th>
          <th style={styles.th}>X</th>
          <th style={styles.th}>D</th>
          <th style={styles.th}>P</th>
          <th style={styles.th}>E</th>
          <th style={styles.th}>Флаги</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => {
          const byDim = new Map(n.dimensions.map((d) => [d.dimension, d.level]));
          return (
            <tr
              key={n.atomId}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectAtom(n.atomId)}
            >
              <td style={styles.td}>
                <code style={styles.code}>{n.atomId}</code>{' '}
                <span style={styles.muted}>{n.name}</span>
              </td>
              <td style={styles.td}>
                <span style={{ color: CLUSTER_COLOR[n.cluster] ?? colors.textDim }}>
                  ●
                </span>{' '}
                {n.cluster}
              </td>
              {(['U', 'X', 'D', 'P', 'E'] as const).map((d) => (
                <td key={d} style={styles.tdNum}>
                  {byDim.get(d) ?? '—'}
                </td>
              ))}
              <td style={styles.td}>
                {n.isWidth && <Badge tone="info">W</Badge>}{' '}
                {n.isDepthExecution && <Badge tone="success">dE</Badge>}{' '}
                {n.isDepthUnderstanding && <Badge tone="default">dU</Badge>}{' '}
                {n.isDepthFull && <Badge tone="master">dF</Badge>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const styles = {
  select: {
    padding: '2px 6px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.xs,
  } as const,
  toggle: {
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
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
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  tdNum: {
    padding: '4px 8px',
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
    fontFamily: 'ui-monospace, monospace',
  } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
};