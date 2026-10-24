// F.4.02.31 — Дерево работ плана.
//
// «Микрорайон» — это не список домов, а дерево: дом → работы → люди. Можно
// раскрыть ветку, дойти до конкретного человека и увидеть, на каком этапе
// работа и кто за неё отвечает.

import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';

interface WorkNode {
  id: string;
  externalId: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  assignedTo: { id: string; name: string; externalId: string } | null;
  total: number;
  done: number;
  children: WorkNode[];
}

interface Plan {
  id: string;
  externalId: string;
  title: string;
  expectedResult: string;
  status: string;
  curatorId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  created: 'Создана',
  assigned: 'Назначена',
  in_progress: 'В работе',
  submitted: 'На проверке',
  accepted: 'Принята',
  returned: 'Возвращена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  if (status === 'accepted') {return 'success';}
  if (status === 'submitted') {return 'info';}
  if (status === 'returned' || status === 'rejected') {return 'danger';}
  if (status === 'in_progress' || status === 'assigned') {return 'warning';}
  return 'default';
}

export function PlanTreePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const planQ = useApiQuery<Plan>(['plan', id ?? ''], `/plans/${id ?? ''}`, {
    enabled: !!id,
  });
  const treeQ = useApiQuery<{ roots: WorkNode[]; total: number; done: number }>(
    ['plan-tree', id ?? ''],
    `/plans/${id ?? ''}/tree`,
    { enabled: !!id },
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allNodes = useMemo(() => {
    const map = new Map<string, WorkNode>();
    const walk = (nodes: WorkNode[]): void => {
      for (const n of nodes) {
        map.set(n.id, n);
        walk(n.children);
      }
    };
    walk(treeQ.data?.roots ?? []);
    return map;
  }, [treeQ.data]);

  const selected = selectedId ? allNodes.get(selectedId) ?? null : null;

  if (planQ.isLoading || treeQ.isLoading) {return <Spinner label="Загружаем дерево…" />;}
  if (planQ.isError || !planQ.data) {
    return <Card title="Ошибка"><p style={styles.muted}>План не найден</p></Card>;
  }

  const toggle = (nodeId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {next.delete(nodeId);} else {next.add(nodeId);}
      return next;
    });
  };

  const renderNode = (node: WorkNode, depth: number): ReactElement => {
    const isOpen = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id}>
        <div
          style={{
            ...styles.row,
            paddingLeft: spacing.sm + depth * 18,
            ...(selectedId === node.id ? styles.rowSelected : {}),
          }}
        >
          <button
            type="button"
            style={styles.toggle}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
            disabled={!hasChildren}
            aria-label={isOpen ? 'Свернуть' : 'Раскрыть'}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
          </button>
          <button
            type="button"
            style={styles.rowMain}
            onClick={() => setSelectedId(node.id)}
          >
            <span style={styles.extId}>{node.externalId}</span>
            <span style={styles.desc}>{node.description}</span>
            <Badge tone={statusTone(node.status)}>
              {STATUS_LABEL[node.status] ?? node.status}
            </Badge>
            <span style={styles.progress}>{node.done}/{node.total}</span>
            <span style={styles.assignee}>
              {node.assignedTo ? node.assignedTo.name : '—'}
            </span>
          </button>
        </div>
        {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const total = treeQ.data?.total ?? 0;
  const done = treeQ.data?.done ?? 0;

  return (
    <div style={styles.page}>
      <Card
        title={
          <div style={styles.header}>
            <span>{planQ.data.title}</span>
            <Badge tone={statusTone(planQ.data.status)}>
              {STATUS_LABEL[planQ.data.status] ?? planQ.data.status}
            </Badge>
          </div>
        }
        subtitle={`${planQ.data.externalId} · принято ${done} из ${total}`}
      >
        <p style={styles.muted}>{planQ.data.expectedResult}</p>
        {(treeQ.data?.roots ?? []).length === 0 ? (
          <p style={styles.muted}>
            В плане пока нет задач. Дерево появится, когда работы будут
            разложены на ветки (родительская задача + подзадачи).
          </p>
        ) : (
          <div style={styles.tree}>
            {(treeQ.data?.roots ?? []).map((root) => renderNode(root, 0))}
          </div>
        )}
      </Card>

      {selected ? (
        <Card title="Узел дерева" subtitle={selected.externalId}>
          <div style={styles.detailRow}>
            <span style={styles.label}>Описание</span>
            <span>{selected.description}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.label}>Статус</span>
            <Badge tone={statusTone(selected.status)}>
              {STATUS_LABEL[selected.status] ?? selected.status}
            </Badge>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.label}>Исполнитель</span>
            <span>
              {selected.assignedTo
                ? `${selected.assignedTo.name} (${selected.assignedTo.externalId})`
                : 'не назначен'}
            </span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.label}>Срок</span>
            <span>
              {selected.deadline
                ? new Date(selected.deadline).toLocaleString('ru-RU')
                : '—'}
            </span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.label}>Поддерево</span>
            <span>
              принято {selected.done} из {selected.total}
              {selected.children.length > 0
                ? `, вложенных работ: ${selected.children.length}`
                : ''}
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  header: { display: 'flex', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  tree: {
    display: 'flex',
    flexDirection: 'column' as const,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderBottom: `1px solid ${colors.borderSoft}`,
    background: colors.bg,
  },
  rowSelected: { background: colors.bgSoft },
  toggle: {
    width: 26,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: 14,
    padding: 4,
  },
  rowMain: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '8px 8px',
    border: 'none',
    background: 'transparent',
    color: colors.text,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    fontSize: fontSize.sm,
  },
  extId: { color: colors.textDim, fontSize: fontSize.xs, width: 120 },
  desc: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  progress: { color: colors.textMuted, fontSize: fontSize.xs, width: 60, textAlign: 'right' as const },
  assignee: { color: colors.textMuted, fontSize: fontSize.xs, width: 140 },
  detailRow: { display: 'flex', gap: spacing.md, padding: '6px 0' },
  label: { color: colors.textMuted, width: 140, flexShrink: 0 },
};
