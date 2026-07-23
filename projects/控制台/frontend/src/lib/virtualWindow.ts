export interface VirtualWindowInput {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
}

export interface VirtualWindow {
  start: number;
  end: number;
  totalHeight: number;
  offsetTop: number;
}

export function calculateVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const count = Math.max(0, Math.floor(input.count));
  const rowHeight = Math.max(1, input.rowHeight);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = Math.max(0, input.scrollTop);
  const overscan = Math.max(0, Math.floor(input.overscan ?? 5));
  const visibleStart = Math.min(count, Math.floor(scrollTop / rowHeight));
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(count, visibleStart + visibleCount + overscan);
  return {
    start,
    end,
    totalHeight: count * rowHeight,
    offsetTop: start * rowHeight,
  };
}
