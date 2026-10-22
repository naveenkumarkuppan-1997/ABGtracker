import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { BACKEND, useApp, useCan } from '@/store/app';

const key = (orgId: string) => `abg2:started:${orgId}`;
const read = (orgId: string) => {
  try {
    return localStorage.getItem(key(orgId)) === 'hidden';
  } catch {
    return false;
  }
};

/** A short, tick-as-you-go list for a new workspace. It checks itself off from what really exists, and goes away when done or dismissed. */
export function GettingStarted({ onCreateProject }: { onCreateProject: () => void }) {
  const data = useApp((s) => s.data)!;
  const canCreate = useCan('project.create');
  const canInvite = useCan('member.manage');
  const [hidden, setHidden] = useState(() => read(data.org.id));
  const first = data.projects[0];

  const steps = [
    { done: data.projects.length > 0, label: 'Create your first project', hint: 'Pick the work style that fits your team: Agile, Flow or Business.', show: canCreate, action: <button className="underline" onClick={onCreateProject}>Create project</button> },
    { done: data.issues.length > 0, label: 'Add your first work item', hint: 'Open the board and use “Create”, or bring a spreadsheet in with Import.', show: !!first, action: first ? <Link className="underline" to={`/${data.org.slug}/p/${first.key}/board`}>Open the board</Link> : null },
    { done: data.members.length > 1, label: 'Invite a teammate', hint: 'They get a link to join. You choose what they can do.', show: canInvite && BACKEND === 'api', action: <Link className="underline" to={`/${data.org.slug}/members`}>Invite people</Link> },
    { done: data.issues.some((i) => i.assigneeId), label: 'Give something an owner', hint: 'Assigned work shows up in that person’s “My work”, Inbox and reminders.', show: data.issues.length > 0, action: first ? <Link className="underline" to={`/${data.org.slug}/p/${first.key}/list`}>Open the list</Link> : null },
  ].filter((s) => s.show || s.done);

  if (hidden || steps.length === 0 || steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <section aria-label="Getting started" className="rounded-xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Getting started</h2>
          <p className="text-xs text-muted">
            {doneCount} of {steps.length} done. This list ticks itself off.
          </p>
        </div>
        <button
          aria-label="Hide getting started"
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(key(data.org.id), 'hidden');
            } catch {
              /* private window: it simply comes back next time */
            }
          }}
        >
          <X size={14} />
        </button>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-sm">
            {s.done ? <CheckCircle2 size={16} className="mt-0.5 text-[#2f9e6b]" aria-label="Done" /> : <Circle size={16} className="mt-0.5 text-muted" aria-label="Not done yet" />}
            <span className={s.done ? 'text-muted line-through' : ''}>
              <b className="font-medium">{s.label}</b>
              {!s.done && (
                <>
                  <span className="block text-xs text-muted">{s.hint}</span>
                  <span className="text-xs">{s.action}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
