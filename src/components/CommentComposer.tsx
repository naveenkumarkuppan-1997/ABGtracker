import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { fileProblem, formatBytes } from '@/domain/attachments';
import type { ID, Member } from '@/domain/types';
import { useApp, useCan } from '@/store/app';
import { Button } from './ui';
import { RichEditor } from './Markdown';
import { useFileLimits } from './Attachments';

/** The new-comment box: text, @mentions, and optionally files (choose, or paste a screenshot). */
export function CommentComposer({ issueId, members }: { issueId: ID; members: Member[] }) {
  const postComment = useApp((s) => s.postComment);
  const notify = useApp((s) => s.notify);
  const canAttach = useCan('issue.edit'); // guests may comment, but only members can add files
  const { limits, blocked, enabled } = useFileLimits();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const filesAllowed = enabled && canAttach;

  const add = (list: File[]) => {
    const ok: File[] = [];
    for (const f of list) {
      const problem = fileProblem(f.name || 'file', f.size, limits, blocked);
      if (problem) notify(`${f.name || 'file'}: ${problem}`);
      else ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok].slice(0, 10));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { posted, failed } = await postComment(issueId, text, files);
    setBusy(false);
    if (posted) {
      setText('');
      setFiles([]);
    }
    if (failed.length) notify(`Comment posted, but ${failed.length} file${failed.length > 1 ? 's' : ''} couldn't be added: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`);
  };

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={submit}
      onPaste={(e) => {
        const pasted = [...e.clipboardData.files];
        if (pasted.length && filesAllowed) {
          e.preventDefault();
          add(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))));
        }
      }}
    >
      <RichEditor label="New comment" rows={3} value={text} members={members} onChange={setText} placeholder="Write a comment… use @ to mention a teammate" />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Files to attach">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
              <Paperclip size={11} className="text-muted" />
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="text-muted">{formatBytes(f.size)}</span>
              <button type="button" aria-label={`Don't attach ${f.name}`} className="text-muted hover:text-danger" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || (!text.trim() && files.length === 0)}>
          {busy ? 'Posting…' : 'Comment'}
        </Button>
        {filesAllowed && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => input.current?.click()}>
              <Paperclip size={13} /> Attach files
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Attach files to the comment"
              onChange={(e) => {
                if (e.target.files) add([...e.target.files]);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
    </form>
  );
}
