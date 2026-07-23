import type { ImageAttachment } from '../types';

interface PersistedAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  hash?: string;
  path?: string;
}

export function attachmentPreviewSource(attachment: ImageAttachment): string {
  if (attachment.dataUrl) return attachment.dataUrl;
  return attachment.previewUrl || `/api/attachments/${encodeURIComponent(attachment.id)}`;
}

export function serializePersistedAttachments(attachments: ImageAttachment[]): string {
  const persisted: PersistedAttachment[] = attachments
    .filter((attachment) => attachment.staged && !attachment.dataUrl)
    .map(({ id, name, type, size, hash, path }) => ({ id, name, type, size, hash, path }));
  return JSON.stringify(persisted);
}

export function parsePersistedAttachments(value: string | null): ImageAttachment[] {
  if (!value) return [];
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const type = typeof record.type === 'string' ? record.type : '';
    const size = typeof record.size === 'number' ? record.size : NaN;
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) return [];
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return [];
    if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) return [];
    return [{
      id,
      name: name.slice(0, 160) || 'image',
      type,
      size,
      hash: typeof record.hash === 'string' ? record.hash : undefined,
      path: typeof record.path === 'string' ? record.path : undefined,
      previewUrl: `/api/attachments/${encodeURIComponent(id)}`,
      staged: true,
    }];
  });
}
