import { useCallback, useEffect, useState } from 'react';
import { api, type DeviceView } from '@/data/apiRepository';
import { useApp } from '@/store/app';
import { Button, cn, Field, Input } from './ui';
import { DeleteAccount } from './DataAndAudit';
import { Connections } from './Integrations';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line pt-4 first:border-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function Profile() {
  const user = useApp((s) => s.authUser);
  const notify = useApp((s) => s.notify);
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Your name">
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api.updateProfile(name);
            useApp.setState({ authUser: r.user });
            await useApp.getState().reloadOrg(); // so your new name shows on your work too
            notify('Name saved.');
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not save.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex-1">
          <Field label={`Signed in as ${user?.email ?? ''}`}>
            <Input aria-label="Your name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !name.trim() || name.trim() === user?.name}>
          Save
        </Button>
      </form>
    </Section>
  );
}

export function TwoFactor() {
  const notify = useApp((s) => s.notify);
  const [status, setStatus] = useState<{ enabled: boolean; recoveryLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.twoFactorStatus().then(setStatus).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <Section title="Two-factor sign-in">{null}</Section>;

  if (recovery) {
    return (
      <Section title="Save your recovery codes">
        <p className="text-sm">
          Two-factor sign-in is <b>on</b>. If you lose your phone, each of these codes lets you in <b>once</b>. They will not be shown again, so keep them somewhere safe (a password manager, or print them).
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-3 font-mono text-sm" aria-label="Recovery codes">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void navigator.clipboard?.writeText(recovery.join('\n')).then(() => notify('Copied.'))}>
            Copy
          </Button>
          <Button size="sm" variant="primary" onClick={() => { setRecovery(null); void load(); }}>
            I have saved them
          </Button>
        </div>
      </Section>
    );
  }

  if (setup) {
    return (
      <Section title="Set up two-factor sign-in">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Authy…) and scan this picture.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        <img alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded-md bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr)}`} />
        <p className="text-center text-xs text-muted">
          Can't scan? Enter this key by hand: <code className="select-all break-all">{setup.secret}</code>
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api.twoFactorConfirm(code);
              setSetup(null);
              setCode('');
              setRecovery(r.recoveryCodes);
            });
          }}
        >
          <div className="flex-1">
            <Field label="6-digit code">
              <Input aria-label="6-digit code" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            Turn on
          </Button>
          <Button type="button" onClick={() => { setSetup(null); setError(null); }}>
            Cancel
          </Button>
        </form>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </Section>
    );
  }

  return (
    <Section title="Two-factor sign-in">
      {status.enabled ? (
        <>
          <p className="text-sm">
            <b className="text-[#2f9e6b]">On.</b> Signing in needs your password and a code from your phone. {status.recoveryLeft} recovery code{status.recoveryLeft === 1 ? '' : 's'} left.
          </p>
          {turningOff ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.twoFactorDisable(password);
                  setPassword('');
                  setTurningOff(false);
                  notify('Two-factor sign-in is off.');
                  await load();
                });
              }}
            >
              <div className="flex-1">
                <Field label="Your password, to confirm">
                  <Input aria-label="Your password" required autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" disabled={busy}>
                Turn off
              </Button>
              <Button type="button" onClick={() => { setTurningOff(false); setError(null); }}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button size="sm" onClick={() => setTurningOff(true)}>
              Turn off…
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Adds a second step at sign-in, so a stolen password alone is not enough. Takes about a minute.</p>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(async () => setSetup(await api.twoFactorBegin()))}>
            Set up…
          </Button>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Section>
  );
}

export function Devices() {
  const notify = useApp((s) => s.notify);
  const [list, setList] = useState<DeviceView[] | null>(null);
  const load = useCallback(() => api.sessions().then((r) => setList(r.sessions)).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Section title="Where you are signed in">
      <ul className="divide-y divide-line rounded-md border border-line text-sm" aria-label="Signed-in devices">
        {(list ?? []).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span>
              <b>{d.device}</b> {d.current && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent-text">this device</span>}
              <span className="block text-xs text-muted">
                {d.ip ? `${d.ip} · ` : ''}signed in {when(d.createdAt)}
              </span>
            </span>
            {!d.current && (
              <Button
                size="sm"
                onClick={async () => {
                  await api.signOutDevice(d.id).catch(() => undefined);
                  notify('Signed out.');
                  await load();
                }}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {(list?.length ?? 0) > 1 && (
        <Button
          size="sm"
          onClick={async () => {
            await api.signOutOthers().catch(() => undefined);
            notify('Signed out everywhere else.');
            await load();
          }}
        >
          Sign out everywhere else
        </Button>
      )}
      <p className="text-xs text-muted">Don't recognise one? Sign it out, then change your password.</p>
    </Section>
  );
}

/** Everything about *you*, in one place: name, second step at sign-in, and where you are signed in. */
export function AccountDialog({ onClose, onPassword }: { onClose: () => void; onPassword: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label="Your account" onMouseDown={(e) => e.stopPropagation()} className={cn('max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-card')}>
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your account</h2>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </header>
        <Profile />
        <Section title="Password">
          <Button size="sm" onClick={() => { onClose(); onPassword(); }}>
            Change password…
          </Button>
        </Section>
        <TwoFactor />
        <Devices />
        <Connections />
        <Section title="Delete my account">
          <DeleteAccount />
        </Section>
      </div>
    </div>
  );
}
