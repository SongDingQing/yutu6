import type { QueueEntry } from '../types';

export function taskText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  for (const key of ['goal', 'task', 'message', 'title', 'summary']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key].trim();
  }
  return '';
}

export function taskTitle(value: unknown, max = 92): string {
  const source = taskText(value).replace(/\r/g, '').trim();
  const first = source.split('\n').find((line) => line.trim())?.trim() || '未命名任务';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export function shortId(value?: string | null): string {
  if (!value) return '-';
  const clean = String(value).replace(/^ceo:/, '');
  return clean.length > 10 ? clean.slice(-8) : clean;
}

export function queueEntryTime(entry: QueueEntry): string {
  return String(
    entry.engine_started_at
      || entry.started_at
      || entry.claimed_at
      || entry.enqueued_at
      || entry.updated_at
      || '',
  );
}

export function formatElapsed(raw?: string | null, now = Date.now()): string {
  const started = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(started)) return '刚刚';
  const totalMinutes = Math.max(0, Math.floor((now - started) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}天 ${hours}小时`;
  if (hours) return `${hours}小时 ${minutes}分钟`;
  return `${Math.max(1, minutes)}分钟`;
}

export function formatClock(raw?: string | null): string {
  const time = raw ? new Date(raw) : new Date();
  if (Number.isNaN(time.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time);
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
