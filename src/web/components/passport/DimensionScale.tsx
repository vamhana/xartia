// F.4.10.01 — Шкала измерения 0..9. null ≠ 0.
// null рисуется пустым серым, 0 — одна чёрная точка на позиции 0.
// Табличный режим — через aria-label: "U: нет оценки" / "U: уровень 5, подтверждено".

import type { ReactElement } from 'react';

import { colors, fontSize, radius, spacing } from '../../theme';
import type { PassportDimensionState } from '../../types';

const DIM_LABEL: Record<string, string> = {
  U: 'Понимание',
  X: 'Объяснение',
  D: 'Проектирование',
  P: 'Выполнение',
  E: 'Оценка',
};

const STATUS_LABEL: Record<string, string> = {
  not_assessed: 'нет оценки',
  declared: 'заявлено',
  confirmed: 'подтверждено',
  disputed: 'оспаривается',
  under_review: 'на пересмотре',
  not_applicable: 'неприменимо',
  calibration_pending: 'калибровка',
};

export function DimensionScale({
  state,
}: {
  state: PassportDimensionState;
}): ReactElement {
  const isNA = state.status === 'not_applicable';
  const isNull = state.level === null;
  const label = DIM_LABEL[state.dimension] ?? state.dimension;

  const aria =
    isNA
      ? `${label}: неприменимо`
      : isNull
      ? `${label}: нет оценки (${STATUS_LABEL[state.status] ?? state.status})`
      : `${label}: уровень ${state.level} (${STATUS_LABEL[state.status] ?? state.status})`;

  return (
    <div style={styles.row} aria-label={aria}>
      <div style={styles.label}>
        <span style={styles.code}>{state.dimension}</span>
        <span style={styles.name}>{label}</span>
      </div>
      <div style={styles.scale} aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => {
          const active = !isNull && !isNA && i === state.level;
          const filled = !isNull && !isNA && i < state.level!;
          return (
            <span
              key={i}
              style={{
                ...styles.cell,
                background: isNA
                  ? 'transparent'
                  : active
                  ? colors.text
                  : filled
                  ? colors.textDim
                  : colors.bg,
                borderColor: isNA ? 'transparent' : colors.border,
              }}
            />
          );
        })}
        <span style={styles.number}>
          {isNA ? '—' : isNull ? 'нет' : String(state.level)}
        </span>
      </div>
      <div style={styles.status}>{STATUS_LABEL[state.status] ?? state.status}</div>
    </div>
  );
}

const styles = {
  row: {
    display: 'grid',
    gridTemplateColumns: '160px 1fr 120px',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px 0',
  } as const,
  label: { display: 'flex', gap: 6, alignItems: 'center' } as const,
  code: {
    fontFamily: 'ui-monospace, "Cascadia Code", monospace',
    fontSize: fontSize.xs,
    color: colors.textDim,
    width: 14,
  } as const,
  name: { fontSize: fontSize.sm } as const,
  scale: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  } as const,
  cell: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: radius.sm,
    display: 'inline-block',
  } as const,
  number: {
    marginLeft: 8,
    fontSize: fontSize.xs,
    color: colors.textDim,
    minWidth: 32,
  } as const,
  status: { fontSize: fontSize.xs, color: colors.textDim } as const,
};