import { ImagePlus, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentApiError, deleteAttachment, enqueueTask, stageAttachment } from '../../lib/api';
import { attachmentPreviewSource, parsePersistedAttachments, serializePersistedAttachments } from '../../lib/attachments';
import { humanFileSize } from '../../lib/format';
import type { ImageAttachment, RoleConfig } from '../../types';

const DRAFT_KEY = 'yt6-react-task-draft';
const DRAFT_ATTACHMENTS_KEY = 'yt6-react-task-draft-attachments';
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface TaskComposerProps {
  roles: Record<string, RoleConfig>;
  onSent: () => Promise<void> | void;
}

export function TaskComposer({ roles, onSent }: TaskComposerProps) {
  const [role, setRole] = useState('secretary');
  const [text, setText] = useState(() => localStorage.getItem(DRAFT_KEY) || '');
  const [images, setImages] = useState<ImageAttachment[]>(() => parsePersistedAttachments(localStorage.getItem(DRAFT_ATTACHMENTS_KEY)));
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectableRoles = useMemo(
    () => Object.entries(roles).filter(([, config]) => !config.archived),
    [roles],
  );

  useEffect(() => {
    if (roles[role] && !roles[role].archived) return;
    if (roles.secretary && !roles.secretary.archived) setRole('secretary');
    else if (roles.orchestrator) setRole('orchestrator');
    else if (selectableRoles[0]) setRole(selectableRoles[0][0]);
  }, [role, roles, selectableRoles]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, text);
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(168, Math.max(46, element.scrollHeight))}px`;
    element.style.overflowY = element.scrollHeight > 168 ? 'auto' : 'hidden';
  }, [text]);

  useEffect(() => {
    localStorage.setItem(DRAFT_ATTACHMENTS_KEY, serializePersistedAttachments(images));
  }, [images]);

  const addFiles = async (files: File[]) => {
    const accepted = files.filter((file) => file.type.startsWith('image/'));
    if (!accepted.length) {
      setFeedback('未识别到图片');
      return;
    }
    const room = Math.max(0, MAX_IMAGES - images.length);
    if (!room) {
      setFeedback(`最多添加 ${MAX_IMAGES} 张图片`);
      return;
    }
    setUploading(true);
    setFeedback('正在暂存图片');
    try {
      const next: ImageAttachment[] = [];
      for (const file of accepted.slice(0, room)) {
        if (file.size > MAX_IMAGE_BYTES) {
          setFeedback(`${file.name} 超过 10MB`);
          continue;
        }
        try {
          next.push(await stageAttachment(file));
        } catch (error) {
          if (!(error instanceof AttachmentApiError) || error.code !== 'ATTACHMENT_STAGING_DISABLED') throw error;
          next.push({
            id: `${Date.now().toString(36)}-${crypto.randomUUID()}`,
            name: file.name || 'pasted-image',
            type: file.type || 'image/png',
            size: file.size,
            dataUrl: await readDataUrl(file),
            staged: false,
          });
        }
      }
      if (next.length) {
        setImages((current) => [...current, ...next].slice(0, MAX_IMAGES));
        setFeedback(`已添加 ${next.length} 张图片`);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? `图片暂存失败: ${error.message}` : '图片暂存失败');
    } finally {
      setUploading(false);
    }
  };

  const dispatch = async () => {
    const goal = text.trim() || (images.length ? `请查看 ${images.length} 张图片附件` : '');
    if (!goal) {
      setFeedback('请输入任务或添加图片');
      textareaRef.current?.focus();
      return;
    }
    setSending(true);
    setFeedback('正在派单');
    try {
      const result = await enqueueTask({ role, goal, attachments: images });
      setText('');
      setImages([]);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DRAFT_ATTACHMENTS_KEY);
      setFeedback(`已入队 #${result.entry.id}`);
      await onSent();
    } catch (error) {
      setFeedback(error instanceof Error ? `派单失败: ${error.message}` : '派单失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <footer className="composer-shell">
      {images.length ? (
        <div className="attachment-strip" role="list" aria-label={`已添加 ${images.length} 张图片`}>
          {images.map((image) => (
            <div className="attachment" role="listitem" key={image.id}>
              <img src={attachmentPreviewSource(image)} alt="" />
              <span>{image.name}<small>{humanFileSize(image.size)}</small></span>
              <button type="button" onClick={() => {
                setImages((current) => current.filter((item) => item.id !== image.id));
                if (image.staged) void deleteAttachment(image.id).catch(() => undefined);
              }} title={`移除 ${image.name}`} aria-label={`移除 ${image.name}`}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-row">
        <label className="role-select">
          <span>派给</span>
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="选择派单角色">
            {selectableRoles.map(([id, config]) => <option value={id} key={id}>{config.label || id}</option>)}
          </select>
        </label>

        <div className="composer-input">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.items]
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (files.length) void addFiles(files);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void dispatch();
              }
            }}
            placeholder="给秘书下达任务…"
            aria-label="任务内容，Enter 发送，Shift+Enter 换行"
            rows={1}
          />
          <button className="composer-icon-button" type="button" onClick={() => fileRef.current?.click()} title="添加图片" aria-label="添加图片">
            <ImagePlus size={19} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles([...(event.target.files || [])]);
              event.target.value = '';
            }}
          />
        </div>

        <button className="send-button" type="button" onClick={() => void dispatch()} disabled={sending || uploading}>
          <Send size={17} />{uploading ? '暂存中' : sending ? '派单中' : '派单'}
        </button>
      </div>
      <div className={`composer-feedback ${feedback.includes('失败') ? 'error' : ''}`} role="status" aria-live="polite">{feedback}</div>
    </footer>
  );
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
