import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api, type AuditEvent } from '@/data/apiRepository';
import { formatDate } from '@/domain/selectors';
import { useApp, useRole } from '@/store/app';
import { Button, Field, Input } from './ui';
import { WebhooksSection } from './Integrations';
import { BillingSection } from './Billing';

const ACTION_LABEL: Record<string, string> = {
  'member.role': 'Changed a role',
  'member.remove': 'Removed a person',
  'member.leave': 'Left the organization',
  'member.join': 'Joined',
  'invite.create': 'Invited',
  'invite.revoke': 'Cancelled an invitation',
  'org.export': 'Exported data',
  'webhook.create': 'Added a webhook',
  'billing.plan': 'Changed the plan',
  'webhook.delete': 'Removed a webhook',
};

function DangerForm({ title, warning, confirmLabel, needName, onSubmit }: { title: string; warning: string; confirmLabel: string; needName?: string; onSubmit: (v: { password: string; code: string; name: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {title}…
      </Button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ password, code, name });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not do that.');
          setBusy(false);
        }
      }}
    >
      <p className="text-sm">{warning}</p>
      {needName && (
        <Field label={`Type “${needName}” to confirm`}>
          <Input aria-label="Organization name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label="Your password">
        <Input aria-label="Your password" required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="6-digit code (only if you use two-factor sign-in)">
        <Input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="!bg-danger !text-white">
          {confirmLabel}
        </Button>
        <Button type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Danger: delete the whole organization. Owner only. */
export function DeleteOrganization({ orgId, orgName }: { orgId: string; orgName: string }) {
  const refresh = useApp((s) => s.refreshSession);
  const navigate = useNavigate();
  return (
    <DangerForm
      title="Delete this organization"
      confirmLabel="Delete everything for good"
      needName={orgName}
      warning={`This permanently deletes ${orgName}: every project, work item, comment, file and person's access. It cannot be undone. Download an export first if you might need anything.`}
      onSubmit={async (v) => {
        await api.deleteOrganization(orgId, { password: v.password, confirmName: v.name, code: v.code || undefined });
        await refresh();
        navigate('/', { replace: true });
      }}
    />
  );
}

/** Danger: erase my account. Inside the Account dialog. */
export function DeleteAccount() {
  const refresh = useApp((s) => s.refreshSession);
  return (
    <DangerForm
      title="Delete my account"
      confirmLabel="Delete my account for good"
      warning="This removes your login and settings. Your name on old comments and history becomes “Deleted user”, and work assigned to you becomes unassigned. If you are the only owner of an organization you must hand it over (or delete it) first."
      onSubmit={async (v) => {
        await api.deleteAccount({ password: v.password, code: v.code || undefined });
        await refresh().catch(() => undefined);
        window.location.assign('/');
      }}
    />
  );
}

export type OrgPart = 'data' | 'billing' | 'webhooks' | 'audit' | 'danger';

/** For owners and admins: export, plan, webhooks, who-did-what, and the delete button. parts picks which to show (default: all). */
export function DataAndAudit({ parts = ['data', 'billing', 'webhooks', 'audit', 'danger'] }: { parts?: OrgPart[] } = {}) {
  const data = useApp((s) => s.data)!;
  const role = useRole();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const isOwner = role === 'owner';

  useEffect(() => {
    api
      .auditLog(data.org.id)
      .then((r) => setEvents(r.events))
      .catch(() => undefined);
  }, [data.org.id]);

  return (
    <>
      {isOwner && parts.includes('data') && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Your data</h2>
          <p className="text-sm text-muted">Download everything whenever you like. Files you attached are listed (name, size, who) but their contents are not in the export.</p>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/orgs/${encodeURIComponent(data.org.id)}/export`} download className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
              <Download size={14} /> Everything (JSON)
            </a>
            <a href={`/api/orgs/${encodeURIComponent(data.org.id)}/export.csv`} download className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
              <Download size={14} /> Work items (spreadsheet)
            </a>
          </div>
        </section>
      )}
      {parts.includes('billing') && <BillingSection orgId={data.org.id} />}
      {parts.includes('webhooks') && <WebhooksSection orgId={data.org.id} />}
      {parts.includes('audit') && (
      <section className="space-y-2 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Audit log</h2>
        <p className="text-sm text-muted">Who changed access to {data.org.name}, newest first.</p>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm" aria-label="Audit log">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="w-28 shrink-0 text-xs text-muted">{formatDate(e.at)}</span>
                <span>
                  <b>{e.actor}</b> · {ACTION_LABEL[e.action] ?? e.action}
                  {e.detail && <span className="text-muted"> — {e.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
      {isOwner && parts.includes('danger') && (
        <section className="space-y-3 rounded-xl border border-danger/40 bg-surface p-5">
          <h2 className="font-semibold text-danger">Danger zone</h2>
          <DeleteOrganization orgId={data.org.id} orgName={data.org.name} />
        </section>
      )}
    </>
  );
}
