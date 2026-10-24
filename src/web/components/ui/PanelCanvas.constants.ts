// F.4.99.28 — Константы. PanelCanvas.src\web\components\ui\PanelCanvas.constants.ts
// Вынесены из PanelCanvas.tsx, чтобы Fast Refresh работал корректно:
// vite-plugin-react требует, чтобы файл экспортировал либо только компоненты,
// либо только не-компоненты.

import { spacing } from '../../theme';

export const COLS = 12;

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export const BASE_ROW_HEIGHT = 20;
export const PREVIEW_ROW_HEIGHT = 20;

export const CANVAS_PADDING = spacing.md;
export const GRID_MARGIN: readonly [number, number] = [8, 8];

export const SCREEN_SIZES = {
  desktop: { label: 'Desktop', w: 1220, h: 800, icon: '🖥' },
  laptop:  { label: 'Laptop',  w: 1040, h: 700, icon: '💻' },
  tablet:  { label: 'Tablet',  w: 768,  h: 1024, icon: '📱' },
  mobile:  { label: 'Mobile',  w: 375,  h: 667,  icon: '📱' },
} as const;
export type ScreenSize = keyof typeof SCREEN_SIZES;

/** Максимальная вложенность — синхронно с MAX_DEPTH в C.0.26.02. */
export const MAX_DEPTH = 5;

export const DRAG_HANDLE_CLASS = 'xartia-drag-handle';