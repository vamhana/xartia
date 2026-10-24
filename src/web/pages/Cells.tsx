// src/web/pages/Cells.tsx
/**
 * F.4.02.05 — Cells page.
 *
 * Дерево ячеек N×5 + карточка выбранной + создание + управление составом.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost, apiDelete } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  Form,
  FormInput,
  FormSelect,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

interface Cell {
  id: string;
  level: number;
  number: string;
  profile?: number | null;
  parentCellId: string | null;
  directionId: string;
  membersCount: number;
  createdAt: string;
}

interface CellMember {
  id: string;
  cellId: string;
  participantId: string;
  roleInCell: string;
  validFrom: string;
  validTo: string | null;
}

interface TreeNode extends Cell {
  children: TreeNode[];
}

// ─── Константы ───────────────────────────────────────────────────

const CELL_ROLES = [
  { value: 'member', label: 'Участник' },
  { value: 'coordinator', label: 'Координатор' },
  { value: 'otc', label: 'ОТК' },
  { value: 'keeper', label: 'Хранитель' },
  { value: 'liaison', label: 'Связной' },
  { value: 'verifier', label: 'Верификатор' },
  { value: 'balancer', label: 'Балансировщик' },
  { value: 'psy', label: 'Психоэколог' },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  CELL_ROLES.map((r) => [r.value, r.label]),
);

const createCellSchema = z.object({
  level: z.coerce.number().int().min(0).max(11),
  number: z.string().min(1, 'Укажите номер').max(16),
  profile: z.coerce.number().int().min(1).max(64).optional(),
  parent_cell_id: z.string().optional(),
});

type CreateCellForm = z.infer<typeof createCellSchema>;

// ─── Сборка дерева ───────────────────────────────────────────────

function buildTree(flat: Cell[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const c of flat) {
    map.set(c.id, { ...c, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentCellId ? map.get(node.parentCellId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a: TreeNode, b: TreeNode): number => {
    if (a.level !== b.level) {return b.level - a.level;}
    return a.number.localeCompare(b.number);
  };
  roots.sort(sortFn);
  for (const n of map.values()) {n.children.sort(sortFn);}
  return roots;
}

// ─── Страница ────────────────────────────────────────────────────

export function CellsPage(): ReactElement {
  const user = useUser();
  const rights = useRights();
  const directionId = user?.participant.directionId ?? '';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Грузим ВСЕ ячейки (до 500) — и строим дерево локально.
  // Для направлений с меньшим числом ячеек это быстрее, чем /tree/:id рекурсивно.
  const listQ = useApiQuery<{ data: Cell[] }>(
    ['cells', 'list', directionId],
    `/cells?direction_id=${directionId}`,
  );

  const flat = listQ.data?.data ?? [];
  const tree = useMemo(() => buildTree(flat), [flat]);

  // Автовыбор первого корня при загрузке
  useEffect(() => {
    if (selectedId) {return;}
    const first = tree[0];
    if (first) {setSelectedId(first.id);}
  }, [tree, selectedId]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Ячейки</h1>
        {rights.hasRight('cell', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать ячейку
          </Button>
        ) : null}
      </div>

      {listQ.isLoading ? (
        <Spinner label="Загружаем ячейки…" />
      ) : flat.length === 0 ? (
        <Card title="Ячеек нет">
          <p style={styles.muted}>
            В направлении ещё нет ячеек. Создайте первую.
          </p>
        </Card>
      ) : (
        <div style={styles.twoCol}>
          <Card title="Дерево">
            <div style={styles.tree}>
              {tree.map((n) => (
                <TreeItem
                  key={n.id}
                  node={n}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          </Card>

          <div style={styles.detailCol}>
            {selectedId ? (
              <CellDetail cellId={selectedId} />
            ) : (
              <Card title="Выберите ячейку">
                <p style={styles.muted}>Клик по ячейке слева</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {creating ? (
        <CreateCellModal
          directionId={directionId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Дерево ──────────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TreeItem({
  node,
  depth,
  selectedId,
  onSelect,
}: TreeItemProps): ReactElement {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const selected = selectedId === node.id;

  return (
    <div>
      <div
        style={{
          ...styles.treeRow,
          paddingLeft: 8 + depth * 16,
          background: selected ? 'rgba(96,165,250,0.15)' : 'transparent',
        }}
        onClick={() => onSelect(node.id)}
      >
        <span
          style={styles.treeToggle}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {setOpen((v) => !v);}
          }}
        >
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </span>
        <span style={styles.treeLabel}>
          {node.level}×5 · {node.number}
          {node.profile ? ` · p${node.profile}` : ''}
        </span>
        <span style={styles.treeCount}>{node.membersCount}</span>
      </div>
      {open && hasChildren
        ? node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

// ─── Карточка ячейки ─────────────────────────────────────────────

function CellDetail({ cellId }: { cellId: string }): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [adding, setAdding] = useState(false);

  const cellQ = useApiQuery<Cell>(['cells', 'detail', cellId], `/cells/${cellId}`);
  const membersQ = useApiQuery<{ data: CellMember[] }>(
    ['cells', 'members', cellId],
    `/cells/${cellId}/members`,
  );
  const childrenQ = useApiQuery<{ data: Cell[] }>(
    ['cells', 'children', cellId],
    `/cells/${cellId}/children`,
  );

  const removeM = useMutation({
    mutationFn: (participantId: string) =>
      apiDelete<void>(`/cells/${cellId}/members/${participantId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cells', 'members', cellId] });
      void qc.invalidateQueries({ queryKey: ['cells', 'list'] });
    },
  });

  if (cellQ.isLoading) {
    return (
      <Card title="Ячейка">
        <Spinner />
      </Card>
    );
  }
  if (cellQ.isError || !cellQ.data) {
    return (
      <Card title="Ячейка">
        <p style={styles.muted}>Не удалось загрузить</p>
      </Card>
    );
  }

  const c = cellQ.data;
  const members = membersQ.data?.data ?? [];
  const children = childrenQ.data?.data ?? [];

  return (
    <Card
      title={`${c.level}×5 · ${c.number}`}
      subtitle={c.profile ? `Профиль ${c.profile}` : undefined}
      actions={
        rights.hasRight('cell', 'C') ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            + Участник
          </Button>
        ) : undefined
      }
    >
      <div style={styles.detailMeta}>
        <span>Состав: {c.membersCount}</span>
        <span>Детей: {children.length}</span>
        <span>Создана: {new Date(c.createdAt).toLocaleDateString('ru-RU')}</span>
      </div>

      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>Состав</div>
        {members.length === 0 ? (
          <p style={styles.muted}>Пусто</p>
        ) : (
          members.map((m) => (
            <div key={m.id} style={styles.memberRow}>
              <span style={styles.memberPid}>
                {m.participantId.slice(0, 8)}…
              </span>
              <Badge tone="info">
                {ROLE_LABEL[m.roleInCell] ?? m.roleInCell}
              </Badge>
              {rights.hasRight('cell', 'D') ? (
                <button
                  type="button"
                  style={styles.removeBtn}
                  onClick={() => {
                    void removeM.mutateAsync(m.participantId);
                  }}
                  disabled={removeM.isPending}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {adding ? (
        <AddMemberModal
          cellId={cellId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Card>
  );
}

// ─── Модалка создания ────────────────────────────────────────────

function CreateCellModal({
  directionId,
  onClose,
}: {
  directionId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  // Список ячеек того же направления, которые могут быть родителями
  // (level + 1 = уровень новой ячейки). Упрощение: показываем все ячейки.
  const parentsQ = useApiQuery<{ data: Cell[] }>(
    ['cells', 'list', directionId],
    `/cells?direction_id=${directionId}`,
  );

  const createM = useMutation({
    mutationFn: (data: CreateCellForm) =>
      apiPost<Cell>('/cells', {
        level: data.level,
        number: data.number,
        ...(typeof data.profile === 'number' ? { profile: data.profile } : {}),
        ...(data.parent_cell_id ? { parent_cell_id: data.parent_cell_id } : {}),
        direction_id: directionId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cells'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  const parentOptions = (parentsQ.data?.data ?? []).map((c) => ({
    value: c.id,
    label: `${c.level}×5 · ${c.number}${c.profile ? ` · p${c.profile}` : ''}`,
  }));

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Новая ячейка">
          <Form<CreateCellForm>
            schema={createCellSchema}
            defaultValues={{
              level: 0,
              number: '',
              profile: undefined,
              parent_cell_id: '',
            }}
            submitLabel="Создать"
            onCancel={onClose}
            loading={createM.isPending}
            onSubmit={async (data) => {
              setErr(null);
              await createM.mutateAsync(data);
            }}
          >
            <FormInput
              name="level"
              label="Уровень"
              type="number"
              placeholder="0..11"
              required
            />
            <FormInput
              name="number"
              label="Номер"
              placeholder="T12345"
              required
            />
            <FormInput
              name="profile"
              label="Профиль"
              type="number"
              placeholder="1..64 (опционально)"
            />
            <FormSelect
              name="parent_cell_id"
              label="Родительская ячейка"
              placeholder="— нет (корневая) —"
              options={parentOptions}
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Модалка добавления участника ────────────────────────────────

const addMemberSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  role_in_cell: z.enum([
    'member', 'coordinator', 'otc', 'keeper',
    'liaison', 'verifier', 'balancer', 'psy',
  ]),
});

type AddMemberForm = z.infer<typeof addMemberSchema>;

function AddMemberModal({
  cellId,
  onClose,
}: {
  cellId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const addM = useMutation({
    mutationFn: (data: AddMemberForm) =>
      apiPost<CellMember>(`/cells/${cellId}/members`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cells', 'members', cellId] });
      void qc.invalidateQueries({ queryKey: ['cells', 'list'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось добавить'),
  });

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Добавить участника">
          <Form<AddMemberForm>
            schema={addMemberSchema}
            defaultValues={{
              participant_id: '',
              role_in_cell: 'member',
            }}
            submitLabel="Добавить"
            onCancel={onClose}
            loading={addM.isPending}
            onSubmit={async (data) => {
              setErr(null);
              await addM.mutateAsync(data);
            }}
          >
            <FormInput
              name="participant_id"
              label="UUID участника"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
            <FormSelect
              name="role_in_cell"
              label="Роль в ячейке"
              required
              options={CELL_ROLES}
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  title: {
    margin: 0,
    fontSize: 22,
    color: colors.text,
  },
  twoCol: {
    display: 'grid' as const,
    gridTemplateColumns: 'minmax(280px, 380px) 1fr',
    gap: spacing.md,
    alignItems: 'start' as const,
  },
  detailCol: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  tree: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 2,
  },
  treeRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: '6px 8px',
    borderRadius: radius.sm,
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  treeToggle: {
    width: 14,
    display: 'inline-block' as const,
    textAlign: 'center' as const,
    color: colors.textMuted,
    cursor: 'pointer' as const,
  },
  treeLabel: {
    flex: 1,
  },
  treeCount: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    padding: '1px 6px',
    background: colors.bgInput,
    borderRadius: radius.full,
  },
  detailMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },
  subBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  memberRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  memberPid: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: colors.text,
    flex: 1,
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.danger,
    cursor: 'pointer' as const,
    fontSize: 16,
    lineHeight: 1,
    padding: '0 6px',
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  modalBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 480,
  },
};