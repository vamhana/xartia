// src/web/pages/_TableDemo.tsx
import { useState } from 'react';
import type { ReactElement } from 'react';

import { Badge } from '../components/ui/Badge';
import { Table, useTableFilter } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';

interface Row {
  id: string;
  name: string;
  priority: 'critical' | 'high' | 'standard' | 'background';
  status: 'new' | 'active' | 'done';
  createdAt: string;
}

const PRIORITIES = ['critical', 'high', 'standard', 'background'] as const;
const STATUSES = ['new', 'active', 'done'] as const;

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: `r-${i}`,
  name: `Задача ${i + 1}`,
  priority: PRIORITIES[i % PRIORITIES.length] ?? 'standard',
  status: STATUSES[i % STATUSES.length] ?? 'new',
  createdAt: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
}));

export function TableDemoPage(): ReactElement {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);

  const { filtered, filter, setFilter } = useTableFilter(
    ROWS,
    (r, q) => r.name.toLowerCase().includes(q.toLowerCase()),
  );

  const total = filtered.length;
  const start = (page - 1) * perPage;
  const pageData = filtered.slice(start, start + perPage);

  const columns: Column<Row>[] = [
    { key: 'id', title: 'ID', width: 80, sortable: true },
    { key: 'name', title: 'Название', sortable: true },
    {
      key: 'priority',
      title: 'Приоритет',
      sortable: true,
      render: (r) => <Badge tone={r.priority}>{r.priority}</Badge>,
    },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone="default">{r.status}</Badge>,
    },
    { key: 'createdAt', title: 'Создано', sortable: true, align: 'right' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Table Demo</h1>
      <input
        type="text"
        placeholder="Поиск по названию…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#0b1220',
          color: '#e2e8f0',
          maxWidth: 320,
        }}
      />
      <div style={{ color: '#94a3b8', fontSize: 12 }}>
        Выбрано: {selected.length} → {selected.join(', ') || '—'}
      </div>
      <Table<Row>
        data={pageData}
        columns={columns}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        getRowId={(r) => r.id}
        onRowClick={(r) => console.warn('clicked', r)}
        pagination={{
          page,
          perPage,
          total,
          onPageChange: setPage,
          onPerPageChange: (n) => {
            setPerPage(n);
            setPage(1);
          },
        }}
      />
    </div>
  );
}