'use client';

import { useState, type DragEvent } from 'react';

/** Where the photo at `index` ends up after the one at `from` moves to `to`. */
export function indexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < index && index <= to) return index - 1;
  if (to <= index && index < from) return index + 1;
  return index;
}

/**
 * Reordering for a row of photo tiles: drag a tile onto another on a pointer,
 * or step it with `move` from buttons, which is what touch and keyboard get.
 */
export function usePhotoReorder<T>(items: T[], onReorder: (items: T[], from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next, from, to);
  };

  const tileProps = (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      // Firefox will not start a drag that carries no data.
      e.dataTransfer.setData('text/plain', '');
    },
    onDragOver: (e: DragEvent) => {
      if (dragIndex !== null) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (dragIndex === null) return;
      e.preventDefault();
      move(dragIndex, index);
      setDragIndex(null);
    },
    onDragEnd: () => setDragIndex(null),
  });

  return { move, tileProps, dragIndex };
}
