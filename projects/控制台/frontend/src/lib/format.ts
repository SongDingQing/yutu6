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

export function taskPresentation(value: unknown, titleMax = 64, purposeMax = 136): {
  title: string;
  purpose: string;
} {
  const source = taskText(value).replace(/\r/g, '').trim();
  if (!source) return { title: '未命名任务', purpose: '' };

  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const compact = lines.join(' ').replace(/\s+/g, ' ').trim();
  const titleMarker = compact.search(/\s*(?:类别|类型|问题|目标|目的|要求|原始目标)\s*[:：]/);
  const purposeMatch = compact.match(
    /(?:问题|目标|目的|要求|原始目标)\s*[:：]\s*(.+?)(?=\s*(?:预期收益|风险(?:\/争议)?|证据|验收|红线)\s*[:：]|$)/,
  );

  let title = titleMarker > 0 ? compact.slice(0, titleMarker).trim() : lines[0];
  let purpose = purposeMatch?.[1]?.trim() || '';

  if (!purpose && lines.length > 1) purpose = lines.slice(1).join(' ');
  if (!purpose && title === compact) {
    const sentenceEnd = compact.search(/[。；!?！？]/);
    if (sentenceEnd > 8 && sentenceEnd < compact.length - 1) {
      title = compact.slice(0, sentenceEnd + 1);
      purpose = compact.slice(sentenceEnd + 1).trim();
    }
  }

  return {
    title: clipText(title || '未命名任务', titleMax),
    purpose: clipText(purpose, purposeMax),
  };
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

function clipText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact || compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(1, max - 1)).trim()}…`;
}
