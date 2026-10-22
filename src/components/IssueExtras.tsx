import { useState } from 'react';
import { Check, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { approvalState, pendingApprovers } from '@/domain/approvals';
import { openBlockers } from '@/domain/dependencies';
import { needsApproval } from '@/domain/issueTypes';
import { isDone, statusOf, timeAgo, typeOf } from '@/domain/selectors';
import type { Issue, Project } from '@/domain/types';
import { Avatar, Badge, Button, cn, Select, Textarea } from './ui';
import { TypeIcon } from './icons';

const STATE_STYLE = {
  pending: { label: 'Awaiting approval', color: '#d9a21b' },
  approved: { label: 'Approved', color: '#2f9e6b' },
  rejected: { label: 'Rejected', color: '#dc4b4b' },
} as const;

export function ApprovalSection({ project, issue, onOpen: _onOpen }: { project: Project; issue: Issue; onOpen?: (k: string) => void }) {
  const data = useApp((s) => s.data!);
  const userId = useApp((s) => s.userId);
  const { updateIssue, decideApproval, resetApproval } = useApp();
  const canEdit = useCan('issue.edit');
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [picking, setPicking] = useState(false);
  const approval = issue.approval;
  const isApprovalType = needsApproval(typeOf(project, issue.typeId));

  if (!approval && !(isApprovalType || picking)) {
    return canEdit ? (
      <button className="text-xs text-muted underline hover:text-fg" onClick={() => setPicking(true)}>
        Request approval…
      </button>
    ) : null;
  }

  const state = approval ? approvalState(approval) : null;
  const mine = approval?.approverIds.includes(userId) && !approval.decisions[userId];
  const member = (id: string) => data.members.find((m) => m.id === id);
  const chosen = approval?.approverIds ?? [];

  return (
    <section className="rounded-lg border border-line p-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <ShieldCheck size={14} /> Approval
        {state && <Badge color={STATE_STYLE[state].color}>{STATE_STYLE[state].label}</Badge>}
      </h3>

      {approval && approval.approverIds.length > 0 ? (
        <ul className="space-y-2">
          {approval.approverIds.map((id) => {
            const d = approval.decisions[id];
            return (
              <li key={id} className="flex items-start gap-2 text-sm">
                <Avatar user={member(id)} size={22} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{member(id)?.name}</span>{' '}
                  {d ? (
                    <span className={cn('text-xs', d.decision === 'approved' ? 'text-[#2f9e6b]' : 'text-danger')}>
                      {d.decision} · {timeAgo(d.at)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">pending</span>
                  )}
                  {d?.comment && <p className="text-xs text-muted">“{d.comment}”</p>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Choose who needs to sign off.</p>
      )}

      {mine && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {rejecting ? (
            <>
              <Textarea aria-label="Reason for rejection" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is this being rejected?" />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!comment.trim()}
                  onClick={async () => {
                    if (await decideApproval(issue.id, 'rejected', comment)) {
                      setRejecting(false);
                      setComment('');
                    }
                  }}
                >
                  Confirm rejection
                </Button>
                <Button size="sm" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void decideApproval(issue.id, 'approved')}>
                <Check size={13} /> Approve
              </Button>
              <Button size="sm" onClick={() => setRejecting(true)}>
                <X size={13} /> Reject…
              </Button>
            </div>
          )}
        </div>
      )}

      {approval && state !== 'pending' && canEdit && (
        <Button size="sm" className="mt-3" onClick={() => void resetApproval(issue.id)}>
          <RotateCcw size={12} /> Request approval again
        </Button>
      )}
      {approval && state === 'pending' && pendingApprovers(approval).length > 0 && <p className="mt-2 text-xs text-muted">Waiting for {pendingApprovers(approval).map((id) => member(id)?.name).join(', ')}.</p>}

      {canEdit && (
        <details className="mt-3 text-xs" open={!approval}>
          <summary className="cursor-pointer text-muted">Edit approvers</summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {data.members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={chosen.includes(m.id)}
                  onChange={() => void updateIssue(issue.id, { approverIds: chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : [...chosen, m.id] })}
                />
                {m.name}
              </label>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function DependenciesSection({ project, issue, onOpen }: { project: Project; issue: Issue; onOpen: (key: string) => void }) {
  const data = useApp((s) => s.data!);
  const updateIssue = useApp((s) => s.updateIssue);
  const canEdit = useCan('issue.edit');
  const all = data.issues.filter((i) => i.projectId === project.id);
  const blockers = all.filter((i) => issue.blockedBy.includes(i.id));
  const blocks = all.filter((i) => i.blockedBy.includes(issue.id));
  const open = openBlockers(project, all, issue);
  const candidates = all.filter((i) => i.id !== issue.id && !issue.blockedBy.includes(i.id) && typeOf(project, i.typeId)?.level !== 2);

  if (!blockers.length && !blocks.length && !canEdit) return null;

  const row = (i: Issue, remove?: () => void) => (
    <li key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <TypeIcon type={typeOf(project, i.typeId)} size={13} />
      <button className="text-xs text-muted hover:underline" onClick={() => onOpen(i.key)}>
        {i.key}
      </button>
      <span className={cn('min-w-0 flex-1 truncate', isDone(project, i) && 'text-muted line-through')}>{i.title}</span>
      <Badge>{statusOf(project, i.statusId)?.name}</Badge>
      {remove && canEdit && (
        <button aria-label={`Remove blocker ${i.key}`} className="text-muted hover:text-danger" onClick={remove}>
          <X size={13} />
        </button>
      )}
    </li>
  );

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Dependencies
        {open.length > 0 && <Badge color="#dc4b4b">Blocked by {open.length}</Badge>}
      </h3>
      {blockers.length > 0 && (
        <>
          <p className="mb-1 text-xs text-muted">Blocked by</p>
          <ul className="mb-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {blockers.map((b) => row(b, () => void updateIssue(issue.id, { blockedBy: issue.blockedBy.filter((x) => x !== b.id) })))}
          </ul>
        </>
      )}
      {blocks.length > 0 && (
        <>
          <p className="mb-1 text-xs text-muted">Blocking</p>
          <ul className="mb-2 divide-y divide-line overflow-hidden rounded-lg border border-line">{blocks.map((b) => row(b))}</ul>
        </>
      )}
      {canEdit && (
        <Select
          aria-label="Add blocker"
          value=""
          onChange={(e) => e.target.value && void updateIssue(issue.id, { blockedBy: [...issue.blockedBy, e.target.value] })}
        >
          <option value="">+ Add “blocked by”…</option>
          {candidates.map((i) => (
            <option key={i.id} value={i.id}>
              {i.key} · {i.title}
            </option>
          ))}
        </Select>
      )}
    </section>
  );
}
