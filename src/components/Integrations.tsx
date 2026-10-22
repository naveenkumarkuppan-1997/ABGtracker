import { useCallback, useEffect, useState } from 'react';
import { api, type TokenInfo, type WebhookInfo } from '@/data/apiRepository';
import { formatDate } from '@/domain/selectors';
import { useApp } from '@/store/app';
import { Button, Field, Input, Select } from './ui';

const SCOPE_LABEL = { read: 'Read only', write: 'Read and write', calendar: 'Calendar feed' } as const;

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const notify = useApp((s) => s.notify);
  return (
    <div role="status" className="space-y-2 rounded-md bg-accent/10 p-3 text-sm">
      <p>
        <b>{label}</b> Copy it now: for your safety it is shown only once.
      </p>
      <code className="block select-all break-all rounded bg-surface p-2 text-xs">{value}</code>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void navigator.clipboard?.writeText(value).then(() => notify('Copied.'))}>
          Copy
        </Button>
        <Button size="sm" variant="primary" onClick={onDone}>
          I have copied it
        </Button>
      </div>
    </div>
  );
}

/** In the Account dialog: personal tokens for scripts, and the private calendar link. */
export function Connections() {
  const notify = useApp((s) => s.notify);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const load = useCallback(() => api.tokens().then((r) => setTokens(r.tokens)).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  const calendar = tokens?.find((t) => t.scope === 'calendar');
  const keys = (tokens ?? []).filter((t) => t.scope !== 'calendar');
  const fail = (e: unknown) => notify(e instanceof Error ? e.message : 'Something went wrong.');

  return (
    <section className="space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Connections</h3>
      {shown && <Secret label={shown.label} value={shown.value} onDone={() => setShown(null)} />}

      <div className="space-y-1">
        <p className="text-sm font-medium">Due dates in my calendar</p>
        <p className="text-xs text-muted">A private link your calendar app (Outlook, Google, Apple) can subscribe to. It shows only the unfinished work assigned to you. Anyone with the link can see those due dates, so keep it private.</p>
        {calendar ? (
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.revokeToken(calendar.id);
                const r = await api.createToken('Calendar', 'calendar');
                setShown({ label: 'Your new calendar link.', value: `${location.origin}/api/cal/${r.token}.ics` });
                await load();
              } catch (e) {
                fail(e);
              }
            }}
          >
            Make a new link (the old one stops working)
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={async () => {
              try {
                const r = await api.createToken('Calendar', 'calendar');
                setShown({ label: 'Your calendar link.', value: `${location.origin}/api/cal/${r.token}.ics` });
                await load();
              } catch (e) {
                fail(e);
              }
            }}
          >
            Create my calendar link
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Access tokens for scripts and tools</p>
        <p className="text-xs text-muted">A token acts as you through the public API, with your permissions, and never more. Treat it like a password.</p>
        <ul className="divide-y divide-line rounded-md border border-line text-sm" aria-label="Access tokens">
          {keys.length === 0 && <li className="px-3 py-2 text-xs text-muted">No tokens yet.</li>}
          {keys.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <b>{t.name}</b> <span className="text-xs text-muted">{SCOPE_LABEL[t.scope]} · {t.hint}… · {t.lastUsedAt ? `used ${formatDate(t.lastUsedAt)}` : 'never used'}</span>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  await api.revokeToken(t.id).catch(fail);
                  await load();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.createToken(name, scope);
              setShown({ label: `Token “${r.view.name}”.`, value: r.token });
              setName('');
              await load();
            } catch (err) {
              fail(err);
            }
          }}
        >
          <Field label="Name">
            <Input aria-label="Token name" required maxLength={60} placeholder="e.g. Reporting script" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Can">
            <Select aria-label="Token access" value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}>
              <option value="read">Read only</option>
              <option value="write">Read and write</option>
            </Select>
          </Field>
          <Button type="submit">Create token</Button>
        </form>
      </div>
    </section>
  );
}

const EVENT_LABEL: Record<string, string> = {
  'issue.created': 'Item created',
  'issue.updated': 'Item changed',
  'issue.deleted': 'Item deleted',
  'comment.created': 'New comment',
};

/** For owners and admins: tell Slack, Teams or any other system when work changes. */
export function WebhooksSection({ orgId }: { orgId: string }) {
  const notify = useApp((s) => s.notify);
  const [hooks, setHooks] = useState<WebhookInfo[]>([]);
  const [all, setAll] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['issue.created']);
  const [format, setFormat] = useState<'json' | 'slack'>('slack');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.webhooks(orgId).then((r) => { setHooks(r.hooks); setAll(r.events); }).catch(() => undefined), [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Webhooks</h2>
      <p className="text-sm text-muted">Send a message to Slack, Microsoft Teams or any other system when work changes. Addresses must be public https links.</p>
      {secret && <Secret label="Signing secret." value={secret} onDone={() => setSecret(null)} />}
      {hooks.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm" aria-label="Webhooks">
          {hooks.map((h) => (
            <li key={h.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs">{h.url}</code>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={h.active}
                    onChange={async (e) => {
                      await api.setWebhookActive(orgId, h.id, e.target.checked).catch((er) => notify(er.message));
                      await load();
                    }}
                  />
                  On
                </label>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      notify(`Test: ${(await api.testWebhook(orgId, h.id)).result}`);
                    } catch (er) {
                      notify(er instanceof Error ? er.message : 'Test failed.');
                    }
                    await load();
                  }}
                >
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove webhook ${h.url}`}
                  onClick={async () => {
                    if (!confirm('Remove this webhook?')) return;
                    await api.deleteWebhook(orgId, h.id).catch((er) => notify(er.message));
                    await load();
                  }}
                >
                  Remove
                </Button>
              </div>
              <p className="text-xs text-muted">
                {h.format === 'slack' ? 'Chat message' : 'Data (JSON)'} · {h.events.map((e) => EVENT_LABEL[e] ?? e).join(', ')} · {h.lastStatus ? `last: ${h.lastStatus}` : 'not used yet'}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const r = await api.createWebhook(orgId, { url, events, format });
            setSecret(r.secret);
            setUrl('');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add the webhook.');
          }
        }}
      >
        <Field label="Address">
          <Input aria-label="Webhook address" required type="url" placeholder="https://hooks.slack.com/services/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {all.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5">
              <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)))} />
              {EVENT_LABEL[ev] ?? ev}
            </label>
          ))}
        </div>
        <Field label="Send as" hint="A chat message works with Slack and Teams. Data (JSON) is signed, for your own systems.">
          <Select aria-label="Send as" value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'slack')}>
            <option value="slack">Chat message</option>
            <option value="json">Data (JSON)</option>
          </Select>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="sm">
          Add webhook
        </Button>
      </form>
    </section>
  );
}
