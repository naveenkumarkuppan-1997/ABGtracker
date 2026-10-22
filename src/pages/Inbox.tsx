import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, CalendarClock, CheckCheck, Inbox as InboxIcon, Mail, MessageSquare, Repeat, ShieldCheck, UserPlus, Zap } from 'lucide-react';
import { BACKEND, useApp } from '@/store/app';
import { timeAgo } from '@/domain/selectors';
import type { Notification, NotificationKind } from '@/domain/types';
import { Avatar, Button, cn, EmptyState } from '@/components/ui';

const META: Record<NotificationKind, { icon: typeof AtSign; verb: string }> = {
  mention: { icon: AtSign, verb: 'mentioned you in' },
  assigned: { icon: UserPlus, verb: 'assigned you' },
  comment: { icon: MessageSquare, verb: 'commented on' },
  status: { icon: Repeat, verb: 'changed the status of' },
  approval: { icon: ShieldCheck, verb: 'updated the approval on' },
  automation: { icon: Zap, verb: 'ran an automation on' },
  intake: { icon: InboxIcon, verb: 'submitted a request:' },
  due: { icon: CalendarClock, verb: 'about' },
};

export function Inbox() {
  const data = useApp((s) => s.data)!;
  const markRead = useApp((s) => s.markNotificationRead);
  const markAll = useApp((s) => s.markAllNotificationsRead);
  const navigate = useNavigate();

  const items = [...data.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = items.filter((n) => !n.read).length;

  const open = async (n: Notification) => {
    const project = data.projects.find((p) => p.id === n.projectId);
    const issue = data.issues.find((i) => i.id === n.issueId);
    if (!n.read) void markRead(n.id);
    if (project && issue) navigate(`/${data.org.slug}/p/${project.key}/board?issue=${issue.key}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-muted">{unread} unread · assignments, mentions, comments and status changes on your work</p>
        </div>
        <div className="flex gap-2">
          {BACKEND === 'api' && (
            <Button onClick={() => navigate(`/${data.org.slug}/settings?tab=notifications`)}>
              <Mail size={15} /> Email settings
            </Button>
          )}
          <Button onClick={() => void markAll()} disabled={!unread}>
            <CheckCheck size={15} /> Mark all read
          </Button>
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState title="You're all caught up" body="Mentions and updates on issues you own or report will show up here." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((n) => {
            const issue = data.issues.find((i) => i.id === n.issueId);
            const actor = data.members.find((m) => m.id === n.actorId);
            const actorName = actor?.name ?? (n.actorId === 'automation' ? 'Automation' : n.actorId === 'intake' ? 'A request form' : n.actorId === 'reminder' ? 'Reminder' : 'Someone');
            const { icon: Icon, verb } = META[n.kind];
            return (
              <li key={n.id}>
                <button
                  onClick={() => void open(n)}
                  className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.read && 'bg-accent/5')}
                >
                  <Avatar user={actor} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <b>{actorName}</b> {verb} <b>{issue ? `${issue.key} ${issue.title}` : 'a deleted issue'}</b>
                    </p>
                    {n.detail && <p className="mt-0.5 truncate text-xs text-muted">{n.detail}</p>}
                    <p className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</p>
                  </div>
                  <Icon size={15} className="mt-1 text-muted" />
                  {!n.read && <span aria-label="Unread" className="mt-2 h-2 w-2 rounded-full bg-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
