import { useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/data/apiRepository';
import { EMAIL_CHOICES, resolvePrefs, SCOPE_CHOICES } from '@/domain/notifyPrefs';
import type { NotifyPrefs } from '@/domain/types';
import { allTimeZones } from '@/domain/timeZone';
import { Button, cn, Field, Select } from './ui';

function Choices<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: { value: T; label: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm', value === o.value ? 'border-accent bg-accent/5' : 'border-line hover:bg-surface-2')}>
          <input type="radio" name={legend} className="mt-0.5" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="font-medium">{o.label}</span>
            <span className="block text-xs text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Two plain questions: how often, and about what. Saved for the person, across all their organizations. */
export function EmailSettings({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const user = useApp((s) => s.authUser);
  const emailReady = useApp((s) => s.serverConfig?.emailEnabled);
  const save = useApp((s) => s.setNotifyPrefs);
  const notify = useApp((s) => s.notify);
  const projects = useApp((s) => s.data?.projects ?? []);
  const [prefs, setPrefs] = useState<NotifyPrefs>(resolvePrefs(user ?? undefined));
  const zones = allTimeZones([prefs.timeZone]);
  const muted = new Set(prefs.mutedProjects ?? []);
  const toggleMute = (id: string) =>
    setPrefs((p) => {
      const next = new Set(p.mutedProjects ?? []);
      if (!next.delete(id)) next.add(id);
      return { ...p, mutedProjects: [...next] }; // mutes in other organizations are kept as they are
    });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const form = (
      <form
        role={embedded ? undefined : 'dialog'}
        aria-label="Email notifications"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await save(prefs);
          setBusy(false);
          if (ok) {
            notify('Email settings saved.');
            onClose();
          }
        }}
        className={embedded ? 'max-w-xl space-y-4 rounded-xl border border-line bg-surface p-5' : 'w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card'}
      >
        <header>
          <h2 className="text-base font-semibold">Email notifications</h2>
          <p className="text-xs text-muted">Your Inbox always shows everything. These choices are only about email, and apply to all your organizations.</p>
        </header>
        {emailReady === false && (
          <p role="status" className="rounded-md bg-accent/10 p-2 text-xs text-accent-text">
            Email isn't set up on this server yet, so nothing is sent for now. Your choices are saved and will apply once it is.
          </p>
        )}
        <Choices legend="Email me" value={prefs.email} options={EMAIL_CHOICES} onChange={(email) => setPrefs((p) => ({ ...p, email }))} />
        {prefs.email !== 'off' && <Choices legend="About" value={prefs.scope} options={SCOPE_CHOICES} onChange={(scope) => setPrefs((p) => ({ ...p, scope }))} />}
        <Field label="Your time zone" hint="Decides when your daily summary arrives and which day “due today” means for you.">
          <Select aria-label="Your time zone" value={prefs.timeZone ?? ''} onChange={(e) => setPrefs((p) => ({ ...p, timeZone: e.target.value || undefined }))}>
            {!prefs.timeZone && <option value="">Not set (UTC)</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Remind me about due dates" hint="You are told once this many days before, once on the day, and once if it slips.">
          <Select aria-label="Remind me about due dates" value={String(prefs.dueLeadDays ?? 1)} onChange={(e) => setPrefs((p) => ({ ...p, dueLeadDays: Number(e.target.value) }))}>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'The day before' : `${n} days before`}
              </option>
            ))}
          </Select>
        </Field>
        {prefs.email !== 'off' && projects.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">Quiet projects</legend>
            <p className="text-xs text-muted">No email about these. They still show in your Inbox.</p>
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={muted.has(p.id)} onChange={() => toggleMute(p.id)} />
                {p.name} <span className="text-xs text-muted">{p.key}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const r = await api.sendTestEmail();
                notify(r.sent ? `Test email sent to ${user?.email}. Check your inbox (and spam).` : (r.reason ?? 'The test email could not be sent.'));
              } catch (e) {
                notify(e instanceof Error ? e.message : 'The test email could not be sent.');
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? 'Sending…' : 'Send me a test email'}
          </Button>
          <span className="flex gap-2">
            {!embedded && (
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
          </span>
        </div>
      </form>
  );
  if (embedded) return form;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      {form}
    </div>
  );
}
