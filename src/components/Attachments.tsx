import { useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { api } from '@/data/apiRepository';
import { DEFAULT_LIMITS, fileProblem, formatBytes, isInlineImage, type AttachmentLimits } from '@/domain/attachments';
import { timeAgo } from '@/domain/selectors';
import type { AttachmentView, ID } from '@/domain/types';
import { BACKEND, useApp, useCan } from '@/store/app';
import { cn, Modal } from './ui';

const fileUrl = (id: ID, query = '') => `/api/files/${encodeURIComponent(id)}${query}`;

/** What the server allows, with sensible defaults while it hasn't answered. */
export function useFileLimits(): { limits: AttachmentLimits; blocked: string[] | undefined; enabled: boolean } {
  const cfg = useApp((s) => s.serverConfig)?.attachments;
  return {
    limits: { ...DEFAULT_LIMITS, maxFileBytes: cfg?.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes, maxFilesPerIssue: cfg?.maxFilesPerIssue ?? DEFAULT_LIMITS.maxFilesPerIssue },
    blocked: cfg?.blockedExtensions,
    enabled: BACKEND === 'api' && (!cfg || cfg.enabled),
  };
}

interface Pending {
  key: number;
  name: string;
  progress: number;
  error?: string;
}

let counter = 0;

/** A picture preview (small version from the server) that opens the full image; falls back to a file icon. */
function Thumb({ a, onOpen }: { a: AttachmentView; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" onClick={onOpen} className="block w-full" title={`${a.name} · ${formatBytes(a.size)}`}>
      {broken ? (
        <span className="grid h-24 w-full place-items-center bg-surface-2 text-muted">
          <ImageIcon size={22} />
        </span>
      ) : (
        <img src={fileUrl(a.id, '?thumb=1')} alt={a.name} loading="lazy" onError={() => setBroken(true)} className="h-24 w-full object-cover" />
      )}
    </button>
  );
}

/** The files of one place (an item, or a single comment): picture grid, then other files as rows. */
function FileGrid({ files, who, canRemove, onRemove, onPreview, compact }: {
  files: AttachmentView[];
  who: (id: ID, a: AttachmentView) => string;
  canRemove: (a: AttachmentView) => boolean;
  onRemove: (a: AttachmentView) => void;
  onPreview: (a: AttachmentView) => void;
  compact?: boolean;
}) {
  const images = files.filter((a) => isInlineImage(a.mime));
  const others = files.filter((a) => !isInlineImage(a.mime));
  return (
    <>
      {images.length > 0 && (
        <ul className={cn('mt-2 grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
          {images.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-lg border border-line bg-surface-2">
              <Thumb a={a} onOpen={() => onPreview(a)} />
              <div className="flex items-center gap-1 px-2 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {canRemove(a) && (
                  <button aria-label={`Remove ${a.name}`} className="text-muted hover:text-danger" onClick={() => onRemove(a)}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {others.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <FileText size={16} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <a href={fileUrl(a.id)} download={a.name} className="block truncate font-medium hover:underline">
                  {a.name}
                </a>
                <span className="text-xs text-muted">
                  {formatBytes(a.size)} · {who(a.uploaderId, a)} · {timeAgo(a.createdAt)}
                </span>
              </div>
              <a aria-label={`Download ${a.name}`} href={fileUrl(a.id)} download={a.name} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                <Download size={14} />
              </a>
              {canRemove(a) && (
                <button aria-label={`Remove ${a.name}`} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger" onClick={() => onRemove(a)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Shared by the item's Files section and by comments: who may remove, who sent it, preview, removal. */
function useFileActions() {
  const data = useApp((s) => s.data!);
  const userId = useApp((s) => s.userId);
  const deleteAttachment = useApp((s) => s.deleteAttachment);
  const notify = useApp((s) => s.notify);
  const canUpload = useCan('issue.edit');
  const canManage = useCan('project.manage');
  const [preview, setPreview] = useState<AttachmentView | null>(null);

  const who = (id: ID, a: AttachmentView) => (a.externalName ? `${a.externalName} (via form)` : (data.members.find((m) => m.id === id)?.name ?? 'Former member'));
  const canRemove = (a: AttachmentView) => (a.uploaderId === userId && !a.externalName ? canUpload : canManage);
  const remove = async (a: AttachmentView) => {
    if (confirm(`Remove “${a.name}”? This can't be undone.`)) {
      if (await deleteAttachment(a.id)) notify('File removed');
    }
  };
  const modal = preview && (
    <Modal title={preview.name} onClose={() => setPreview(null)} width="max-w-4xl">
      <div className="space-y-3">
        <img src={fileUrl(preview.id, '?inline=1')} alt={preview.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg" />
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={12} /> {formatBytes(preview.size)} · {who(preview.uploaderId, preview)} · {timeAgo(preview.createdAt)}
          </span>
          <a href={fileUrl(preview.id)} download={preview.name} className="inline-flex items-center gap-1 text-accent-text underline">
            <Download size={12} /> Download
          </a>
        </div>
      </div>
    </Modal>
  );
  return { who, canRemove, remove, setPreview, modal };
}

/** Files attached to one comment, shown under it. */
export function CommentFiles({ commentId }: { commentId: ID }) {
  const files = useApp((s) => s.data!.attachments.filter((a) => a.commentId === commentId));
  const { who, canRemove, remove, setPreview, modal } = useFileActions();
  if (!files.length) return null;
  return (
    <>
      <FileGrid files={files} who={who} canRemove={canRemove} onRemove={(a) => void remove(a)} onPreview={setPreview} compact />
      {modal}
    </>
  );
}

/** Files on an item: drop, pick or paste to add; click to preview or download; remove if yours (or if you're an admin). */
export function AttachmentsSection({ issueId }: { issueId: ID }) {
  const data = useApp((s) => s.data!);
  const reloadOrg = useApp((s) => s.reloadOrg);
  const canUpload = useCan('issue.edit');
  const { limits, blocked, enabled } = useFileLimits();
  const { who, canRemove, remove, setPreview, modal } = useFileActions();
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Files that belong to a comment are shown under that comment; everything else lives here.
  const all = data.attachments.filter((a) => a.issueId === issueId);
  const files = all.filter((a) => !a.commentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (BACKEND === 'local') {
    return (
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Paperclip size={13} /> Files
        </h3>
        <p className="text-sm text-muted">File attachments need the server. They aren't available in the offline demo.</p>
      </section>
    );
  }
  if (!enabled) return null; // switched off on this server

  const upload = async (list: File[]) => {
    for (const file of list) {
      const key = ++counter;
      const problem = fileProblem(file.name || 'file', file.size, limits, blocked);
      if (problem) {
        setPending((p) => [...p, { key, name: file.name || 'file', progress: 0, error: problem }]);
        continue;
      }
      if (all.length + 1 > limits.maxFilesPerIssue) {
        setPending((p) => [...p, { key, name: file.name, progress: 0, error: `An item can have up to ${limits.maxFilesPerIssue} files.` }]);
        continue;
      }
      setPending((p) => [...p, { key, name: file.name || 'pasted file', progress: 0 }]);
      try {
        await api.uploadAttachment(issueId, file, (f) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: f } : x))));
        setPending((p) => p.filter((x) => x.key !== key));
        await reloadOrg();
      } catch (e) {
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : 'Upload failed.' } : x)));
      }
    }
  };

  const onPick = (list: FileList | null) => {
    if (list && list.length) void upload([...list]);
    if (input.current) input.current.value = ''; // picking the same file again should still work
  };

  return (
    <section
      aria-label="Files"
      onPaste={(e) => {
        const pasted = [...e.clipboardData.files];
        if (pasted.length && canUpload) {
          e.preventDefault();
          void upload(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))));
        }
      }}
    >
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <Paperclip size={13} /> Files
        {all.length > 0 && <span className="font-normal normal-case">{all.length}</span>}
      </h3>

      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload([...e.dataTransfer.files]);
          }}
          className={cn('flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-sm transition', over ? 'border-accent bg-accent/10' : 'border-line bg-surface-2')}
        >
          <Upload size={16} className="text-muted" />
          <span>
            Drop files here, or{' '}
            <button type="button" className="font-medium text-accent-text underline" onClick={() => input.current?.click()}>
              choose files
            </button>
          </span>
          <span className="text-xs text-muted">You can also paste an image. Up to {formatBytes(limits.maxFileBytes)} each.</span>
          <input ref={input} type="file" multiple hidden aria-label="Choose files to attach" onChange={(e) => onPick(e.target.files)} />
        </div>
      ) : (
        files.length === 0 && <p className="text-sm text-muted">No files.</p>
      )}

      {pending.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-live="polite">
          {pending.map((p) => (
            <li key={p.key} className="rounded-md border border-line px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.error ? (
                  <button aria-label={`Dismiss ${p.name}`} className="text-muted hover:text-fg" onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))}>
                    <X size={14} />
                  </button>
                ) : (
                  <span className="text-xs text-muted">{Math.round(p.progress * 100)}%</span>
                )}
              </div>
              {p.error ? (
                <p role="alert" className="mt-0.5 text-xs text-danger">
                  {p.error}
                </p>
              ) : (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(p.progress * 100)}>
                  <div className="h-full bg-accent transition-all" style={{ width: `${p.progress * 100}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <FileGrid files={files} who={who} canRemove={canRemove} onRemove={(a) => void remove(a)} onPreview={setPreview} />
      {modal}
    </section>
  );
}
