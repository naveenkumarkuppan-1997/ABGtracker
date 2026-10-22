import { useState } from 'react';
import { Eye, EyeOff, SmilePlus } from 'lucide-react';
import { REACTIONS } from '@/domain/mentions';
import type { Comment, Issue } from '@/domain/types';
import { useApp, useCan } from '@/store/app';
import { cn } from './ui';

/** Follow an item to hear about its comments and status changes (commenting follows it for you). */
export function WatchButton({ issue }: { issue: Issue }) {
  const userId = useApp((s) => s.userId);
  const setWatching = useApp((s) => s.setWatching);
  const watching = (issue.watcherIds ?? []).includes(userId);
  const count = (issue.watcherIds ?? []).length;
  return (
    <button
      type="button"
      aria-pressed={watching}
      title={watching ? 'You will hear about comments and status changes. Click to stop.' : 'Hear about comments and status changes on this item'}
      onClick={() => void setWatching(issue.id, !watching)}
      className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs', watching ? 'border-accent bg-accent/10 text-accent-text' : 'border-line text-muted hover:bg-surface-2')}
    >
      {watching ? <Eye size={13} /> : <EyeOff size={13} />} {watching ? 'Watching' : 'Watch'}
      {count > 0 && <span className="text-muted">· {count}</span>}
    </button>
  );
}

/** Emoji under a comment: who reacted, one click to add or take back yours. */
export function Reactions({ comment }: { comment: Comment }) {
  const userId = useApp((s) => s.userId);
  const members = useApp((s) => s.data?.members ?? []);
  const toggle = useApp((s) => s.toggleReaction);
  const canReact = useCan('comment.add');
  const [picking, setPicking] = useState(false);
  const used = Object.entries(comment.reactions ?? {}).filter(([, ids]) => ids.length > 0);
  if (!used.length && !canReact) return null;
  const names = (ids: string[]) => ids.map((id) => (id === userId ? 'You' : members.find((m) => m.id === id)?.name ?? 'Someone')).join(', ');
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" aria-label="Reactions">
      {used.map(([emoji, ids]) => (
        <button
          key={emoji}
          type="button"
          disabled={!canReact}
          aria-pressed={ids.includes(userId)}
          aria-label={`${emoji} ${ids.length}: ${names(ids)}`}
          title={names(ids)}
          onClick={() => void toggle(comment.id, emoji)}
          className={cn('rounded-full border px-1.5 py-0.5 text-xs', ids.includes(userId) ? 'border-accent bg-accent/10' : 'border-line hover:bg-surface')}
        >
          {emoji} {ids.length}
        </button>
      ))}
      {canReact && (
        <span className="relative">
          <button type="button" aria-label="Add a reaction" aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="rounded-full p-1 text-muted hover:bg-surface hover:text-fg">
            <SmilePlus size={14} />
          </button>
          {picking && (
            <span role="menu" className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-line bg-surface p-1 shadow-card">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  aria-label={`React with ${e}`}
                  className="rounded p-1 hover:bg-surface-2"
                  onClick={() => {
                    setPicking(false);
                    void toggle(comment.id, e);
                  }}
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
