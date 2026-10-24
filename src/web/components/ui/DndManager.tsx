// F.4.99.29 — Глобальный DndManager для Конструктора.src\web\components\ui\DndManager.tsx
//
// PanelCanvas регистрируется под ключом parentId (null для корня, uuid
// контейнера для nested). На dragover/drop менеджер ищет ближайший к точке
// курсора элемент с атрибутом data-canvas-region, берёт его значение и
// находит по нему регистрацию. Для корня значение '__root__' — маппится
// на регистрацию с parentId=null.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

const ROOT_REGION = '__root__';
const WIDGET_MIME = 'application/x-xartia-widget';

export interface CanvasRegistration {
  parentId: string | null;
  depth: number;
  computeDrop: (
    cx: number,
    cy: number,
  ) => { x: number; y: number; w: number; h: number } | null;
  commitDrop: (cx: number, cy: number, e: DragEvent) => void;
  setPreview: (
    p: { x: number; y: number; w: number; h: number } | null,
  ) => void;
}

interface DndManagerApi {
  register: (r: CanvasRegistration) => () => void;
}

const DndContext = createContext<DndManagerApi | null>(null);

/** Возвращает null вне DndProvider. PanelCanvas это проверяет. */
export function useDndManager(): DndManagerApi | null {
  return useContext(DndContext);
}

function isWidgetDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) {return false;}
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t === WIDGET_MIME || t === 'text/plain') {return true;}
  }
  return false;
}

export function DndProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const byKeyRef = useRef<Map<string, CanvasRegistration>>(new Map());
  const ownerRef = useRef<CanvasRegistration | null>(null);

  const register = useCallback((r: CanvasRegistration) => {
    const key = r.parentId ?? ROOT_REGION;
    byKeyRef.current.set(key, r);
    return () => {
      if (byKeyRef.current.get(key) === r) {byKeyRef.current.delete(key);}
      if (ownerRef.current === r) {ownerRef.current = null;}
    };
  }, []);

  const api = useMemo<DndManagerApi>(() => ({ register }), [register]);

  useEffect(() => {
    // Ищем владельца по ближайшему предку с data-canvas-region от точки.
    // Приоритет отдаём элементу, наиболее глубоко в дереве DOM.
    const pickOwner = (cx: number, cy: number): CanvasRegistration | null => {
      const stack = document.elementsFromPoint(cx, cy);
      console.warn('[DndManager pickOwner]', {
        stack: stack.slice(0, 5).map((el) => ({
          tag: el.tagName,
          cls: String((el as HTMLElement).className).slice(0, 60),
          region: (el as HTMLElement).getAttribute?.('data-canvas-region'),
        })),
        registryKeys: Array.from(byKeyRef.current.keys()),
      });
      for (const el of stack) {
        const marked = el.closest?.(
          '[data-canvas-region]',
        ) as HTMLElement | null;
        if (!marked) {continue;}

        const attr = marked.getAttribute('data-canvas-region') ?? '';
        const key = attr === ROOT_REGION ? ROOT_REGION : attr;
        const reg = byKeyRef.current.get(key);
        if (reg) {return reg;}
        // Маркер есть, но регистрации нет (например, PanelPreview с
        // interactive=false) — продолжаем обход.
      }
      return null;
    };

    const setOwner = (next: CanvasRegistration | null): void => {
      const prev = ownerRef.current;
      if (prev === next) {return;}
      if (prev) {prev.setPreview(null);}
      ownerRef.current = next;
    };

    const onDragOver = (e: DragEvent): void => {
      if (!isWidgetDrag(e)) {return;}

      const owner = pickOwner(e.clientX, e.clientY);
      setOwner(owner);
      if (!owner) {return;}

      const p = owner.computeDrop(e.clientX, e.clientY);
      if (!p) {
        owner.setPreview(null);
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {e.dataTransfer.dropEffect = 'copy';}
      owner.setPreview(p);
    };

    const onDrop = (e: DragEvent): void => {
      if (!isWidgetDrag(e)) {return;}

      const owner = pickOwner(e.clientX, e.clientY);
      if (!owner) {return;}

      const p = owner.computeDrop(e.clientX, e.clientY);
      if (!p) {
        setOwner(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setOwner(null);
      owner.commitDrop(e.clientX, e.clientY, e);
    };

    const onDragEnd = (): void => setOwner(null);

    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', onDragEnd, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('dragend', onDragEnd, true);
    };
  }, []);

  return <DndContext.Provider value={api}>{children}</DndContext.Provider>;
}