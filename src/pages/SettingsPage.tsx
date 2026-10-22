import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ChangePasswordDialog } from '@/pages/AuthPages';
import { Devices, Profile, TwoFactor } from '@/components/AccountDialog';
import { DataAndAudit, DeleteAccount } from '@/components/DataAndAudit';
import { EmailSettings } from '@/components/EmailSettings';
import { Connections, WebhooksSection } from '@/components/Integrations';
import { BillingSection } from '@/components/Billing';
import { BACKEND, useApp, useCan, useRole } from '@/store/app';
import { Button, cn, EmptyState } from '@/components/ui';

type TabId = 'account' | 'notifications' | 'organization' | 'billing' | 'integrations' | 'projects';

/** Every card on this page is its own box; the pieces were first written for a dialog, so their own top rule is switched off. */
function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-5 [&>section]:border-0 [&>section]:pt-0">
      {title && (
        <header>
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </header>
      )}
      {children}
    </div>
  );
}

function Projects() {
  const data = useApp((s) => s.data)!;
  const canManage = useCan('project.manage');
  const link = 'rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2';
  return (
    <div className="space-y-4">
      <Card title="Projects" hint="Workflow, statuses and fields live inside each project. Columns, fields and item types are also under the Customize and Fields buttons on a board.">
        {data.projects.length === 0 && <p className="text-sm text-muted">No projects yet.</p>}
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Projects">
          {data.projects.map((p) => {
            const base = `/${data.org.slug}/p/${p.key}`;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {p.name} <span className="text-xs font-normal text-muted">{p.key}</span>
                </span>
                <Link className={link} to={`${base}/board`}>Board</Link>
                {canManage && <Link className={link} to={`${base}/settings`}>Workflow &amp; fields</Link>}
                {canManage && <Link className={link} to={`${base}/forms`}>Request forms</Link>}
                {canManage && <Link className={link} to={`${base}/automation`}>Automation</Link>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/** One place for everything you can change: about you, your emails, your organization, its plan, and connections to other tools. */
export function SettingsPage() {
  const data = useApp((s) => s.data)!;
  const role = useRole();
  const canManage = useCan('member.manage');
  const [params, setParams] = useSearchParams();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const online = BACKEND === 'api';

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'account', label: 'My account', show: online },
    { id: 'notifications', label: 'Notifications', show: online },
    { id: 'organization', label: 'Organization', show: online && canManage },
    { id: 'billing', label: 'Plan & billing', show: online && canManage },
    { id: 'integrations', label: 'Integrations', show: online },
    { id: 'projects', label: 'Projects', show: true },
  ];
  const visible = tabs.filter((t) => t.show);
  const asked = params.get('tab') as TabId | null;
  const current = visible.find((t) => t.id === asked)?.id ?? visible[0].id; // an unknown or not-allowed tab falls back to the first one you can use

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted">
          {data.org.name} · you are {role === 'owner' ? 'an owner' : role === 'admin' ? 'an admin' : role === 'guest' ? 'a guest' : 'a member'}
        </p>
      </header>

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {visible.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === current}
            aria-controls="settings-panel"
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', t.id === current ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${current}`} className="space-y-4">
        {current === 'account' && (
          <>
            <Card><Profile /></Card>
            <Card title="Password">
              <Button size="sm" onClick={() => setPasswordOpen(true)}>Change password…</Button>
            </Card>
            <Card><TwoFactor /></Card>
            <Card><Devices /></Card>
            <Card title="Delete my account"><DeleteAccount /></Card>
          </>
        )}

        {current === 'notifications' && <EmailSettings embedded onClose={() => undefined} />}

        {current === 'organization' && (
          <>
            <Card title="People">
              <Link to={`/${data.org.slug}/members`} className="inline-flex items-center gap-1 text-sm underline">
                Invite people and manage roles <ChevronRight size={14} />
              </Link>
            </Card>
            <DataAndAudit parts={['data', 'audit', 'danger']} />
          </>
        )}

        {current === 'billing' && <BillingSection orgId={data.org.id} />}

        {current === 'integrations' && (
          <>
            <Card><Connections /></Card>
            {canManage ? <WebhooksSection orgId={data.org.id} /> : <EmptyState title="Webhooks are for admins" body="Ask an owner or admin to connect Slack, Teams or other systems." />}
          </>
        )}

        {current === 'projects' && <Projects />}
      </div>
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}
