// src/web/pages/_ChartDemo.tsx
import type { ReactElement } from 'react';

import { Card } from '../components/ui/Card';
import {
  Chart,
  FlowIndicator,
  MetricCard,
  Sparkline,
  ProgressBar,
} from '../components/ui/Chart';

const lineData = [
  { name: 'Пн', signals: 12, tasks: 8 },
  { name: 'Вт', signals: 19, tasks: 11 },
  { name: 'Ср', signals: 15, tasks: 14 },
  { name: 'Чт', signals: 22, tasks: 9 },
  { name: 'Пт', signals: 18, tasks: 16 },
  { name: 'Сб', signals: 9, tasks: 5 },
  { name: 'Вс', signals: 7, tasks: 3 },
];

const pieData = [
  { name: 'main', value: 62 },
  { name: 'reflective', value: 14 },
  { name: 'council', value: 10 },
  { name: 'mentoring', value: 8 },
  { name: 'creation', value: 4 },
  { name: 'cross_direction', value: 2 },
];

const radarData = [
  { axis: 'Нагрузка', value: 78 },
  { axis: 'Просрочка', value: 22 },
  { axis: 'Возвраты', value: 35 },
  { axis: 'Качество', value: 88 },
  { axis: 'Скорость', value: 71 },
];

const spark = Array.from({ length: 20 }, (_, i) => ({
  value: 50 + Math.round(30 * Math.sin(i / 3) + Math.random() * 10),
}));

export function ChartDemoPage(): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Chart Demo</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard value={1247} label="Участников" trend={4.2} trendDirection="up" />
        <MetricCard value={83} label="Активных сигналов" trend={-1.8} trendDirection="down" />
        <MetricCard value="15.3%" label="Просрочка" hint="за неделю" />
        <MetricCard value={92} label="Индекс зрелости" />
      </div>

      <Card title="Line — динамика сигналов и задач">
        <Chart
          type="line"
          data={lineData}
          config={{
            xKey: 'name',
            series: [
              { key: 'signals', label: 'Сигналы' },
              { key: 'tasks', label: 'Задачи' },
            ],
          }}
          height={240}
        />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Area — накопительно">
          <Chart
            type="area"
            data={lineData}
            config={{
              xKey: 'name',
              series: [
                { key: 'signals', label: 'Сигналы' },
                { key: 'tasks', label: 'Задачи' },
              ],
            }}
            height={220}
          />
        </Card>

        <Card title="Bar — сравнение">
          <Chart
            type="bar"
            data={lineData}
            config={{
              xKey: 'name',
              series: [
                { key: 'signals', label: 'Сигналы' },
                { key: 'tasks', label: 'Задачи' },
              ],
            }}
            height={220}
          />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <Card title="Pie — распределение Потоков">
          <Chart
            type="pie"
            data={pieData}
            config={{ valueKey: 'value', nameKey: 'name' }}
            height={220}
          />
        </Card>

        <Card title="Circular — тот же pie с дыркой">
          <Chart
            type="circular"
            data={pieData}
            config={{ valueKey: 'value', nameKey: 'name' }}
            height={220}
          />
        </Card>

        <Card title="Radar — метрики направления">
          <Chart
            type="radar"
            data={radarData}
            config={{
              xKey: 'axis',
              series: [{ key: 'value', label: 'Значение' }],
            }}
            height={220}
          />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <Card title="FlowIndicator — три состояния">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <FlowIndicator balance={15} max={180} label="Критично" />
            <FlowIndicator balance={90} max={180} label="Средне" />
            <FlowIndicator balance={160} max={180} label="Хорошо" />
          </div>
        </Card>

        <Card title="Sparkline + ProgressBar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Тренд:</span>
              <Sparkline data={spark} />
            </div>
            <ProgressBar value={42} max={100} label="Капсула" />
            <ProgressBar value={128} max={180} label="Капсула (2)" />
          </div>
        </Card>

        <Card title="MetricCard с hint">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <MetricCard value="0.87" label="Индекс устойчивости" hint="норма ≥ 0.75" />
            <MetricCard value={341} label="Потоков за неделю" trend={12.5} trendDirection="up" />
          </div>
        </Card>
      </div>
    </div>
  );
}