import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/data/apiRepository';
import type { Role } from '@/domain/types';
import { ROLE_LABEL } from '@/domain/permissions';
import { NEEDS_CODE, useApp } from '@/store/app';
import { Button, cn, Field, Input } from '@/components/ui';

function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg">A</span>
          <span className="text-lg font-semibold">ABG Tracker</span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;

  const isUnauthorizedDomain =
    message.includes('auth/unauthorized-domain') ||
    message.includes('unauthorized-domain') ||
    message.includes('not authorized for Firebase Authentication');

  if (isUnauthorizedDomain) {
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      <div role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2 text-left">
        <p className="font-semibold text-amber-100 flex items-center gap-1.5">
          <span>⚠️</span> Domain Authorization Required
        </p>
        <p className="text-muted">
          Firebase Authentication restricts sign-in to authorized domains. To enable sign-in from this instance, add this hostname:
        </p>
        <div className="rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-amber-300 break-all select-all border border-amber-500/20">
          {currentHost || 'current-domain'}
        </div>
        <ol className="list-decimal list-inside space-y-1 text-muted text-[11px] leading-relaxed pt-1">
          <li>Open <strong className="text-fg">Firebase Console</strong> (<code className="text-fg font-mono">abgtracker-a9a6</code>).</li>
          <li>Go to <strong className="text-fg">Authentication &gt; Settings &gt; Authorized domains</strong>.</li>
          <li>Click <strong className="text-fg">Add domain</strong> and paste the hostname above.</li>
        </ol>
      </div>
    );
  }

  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

const SSO_PROBLEMS: Record<string, string> = {
  state: 'That sign-in did not start from this browser, so it was stopped for your safety. Please try again.',
  verify: 'The sign-in could not be verified. Please try again.',
  unverified: 'Your company login has not confirmed your email address, so we cannot sign you in with it.',
  closed: 'There is no account for that address yet, and new workspaces are closed. Ask an administrator for an invitation.',
};

/** Sign in / create an organization. Shown to anyone who is not signed in. */
export function AuthScreen() {
  const signIn = useApp((s) => s.signIn);
  const register = useApp((s) => s.register);
  const signInWithGoogle = useApp((s) => s.signInWithGoogle);
  const signInWithMicrosoft = useApp((s) => s.signInWithMicrosoft);
  const firebaseConfigured = useApp((s) => s.firebaseConfigured);
  const connectionError = useApp((s) => s.connectionError);
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [allowSignup, setAllowSignup] = useState(true);
  const [sso, setSso] = useState<{ label: string; mock: boolean } | null>(null);
  // The identity provider sends people back here with a short code when something went wrong.
  const ssoProblem = SSO_PROBLEMS[new URLSearchParams(location.search).get('sso_error') ?? ''];
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    api.config().then((c) => {
      if (!live) return;
      setAllowSignup(c.allowSignup);
      setSso(c.sso ?? null);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError(null);
    const err = await signInWithGoogle();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    const slug = location.pathname.split('/')[1];
    if (!useApp.getState().orgs.some((o) => o.slug === slug) && !['forms', 'invite', 'reset'].includes(slug)) {
      navigate('/', { replace: true });
    }
  };

  const handleMicrosoftSignIn = async () => {
    setBusy(true);
    setError(null);
    const err = await signInWithMicrosoft();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    const slug = location.pathname.split('/')[1];
    if (!useApp.getState().orgs.some((o) => o.slug === slug) && !['forms', 'invite', 'reset'].includes(slug)) {
      navigate('/', { replace: true });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'forgot') {
      try {
        await api.forgotPassword(email);
        setSent(true);
      } catch (err2) {
        setError(err2 instanceof Error ? err2.message : 'Could not send the email.');
      }
      setBusy(false);
      return;
    }
    const err = mode === 'login' ? await signIn(email, password, needCode ? code : undefined) : await register({ name, email, password, orgName });
    setBusy(false);
    if (err === NEEDS_CODE) {
      setNeedCode(true); // the password was right; now the second step
      return;
    }
    if (err) return setError(err);
    // Keep a deep link only if it points into one of this person's own organizations.
    const slug = location.pathname.split('/')[1];
    if (!useApp.getState().orgs.some((o) => o.slug === slug) && !['forms', 'invite', 'reset'].includes(slug)) navigate('/', { replace: true });
  };

  return (
    <Frame
      title={mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Reset your password' : 'Create your workspace'}
      subtitle={mode === 'login' ? 'Welcome back.' : mode === 'forgot' ? "Enter your email and we'll send you a link." : 'Start a new organization. You will be its owner.'}
    >
      {connectionError && <p role="alert" className="mb-4 rounded-md bg-danger/10 p-2.5 text-sm text-danger">{connectionError}</p>}
      {ssoProblem && <p role="alert" className="mb-4 rounded-md bg-danger/10 p-2.5 text-sm text-danger">{ssoProblem}</p>}

      {/* Google and Microsoft Identity Federation */}
      {mode !== 'forgot' && (
        <div className="mb-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-fg shadow-xs hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Google</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleMicrosoftSignIn}
              className="flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-fg shadow-xs hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z" />
                <path fill="#81bc06" d="M12 1h10v10H12z" />
                <path fill="#05a6f0" d="M1 12h10v10H1z" />
                <path fill="#ffba08" d="M12 12h10v10H12z" />
              </svg>
              <span>Microsoft</span>
            </button>
          </div>
          <div className="relative my-3 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-line"></div></div>
            <span className="relative bg-surface px-2 text-xs text-muted">or continue with email</span>
          </div>
        </div>
      )}

      {sso && mode === 'login' && (
        <div className="mb-4 space-y-3">
          <a href="/api/auth/sso/start" className="block rounded-md border border-line bg-surface px-3 py-2 text-center text-sm font-medium hover:bg-surface-2">
            {sso.label}
          </a>
          {sso.mock && <p className="text-center text-xs text-muted">Demo sign-in: no real company login is involved.</p>}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <>
            <Field label="Your name">
              <Input required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Organization name">
              <Input required autoComplete="organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} placeholder="e.g. Acme Software" />
            </Field>
          </>
        )}
        {mode === 'login' && needCode && (
          <Field label="Your 6-digit code" hint="From your authenticator app. Lost your phone? Type one of your recovery codes instead.">
            <Input required autoFocus inputMode="text" autoComplete="one-time-code" aria-label="Your 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
          </Field>
        )}
        <div className={needCode && mode === 'login' ? 'hidden' : 'space-y-4'}>
        <Field label="Work email">
          <Input required type="email" autoFocus={mode === 'login'} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password" hint={mode === 'register' ? 'At least 10 characters.' : undefined}>
            <Input required type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        </div>
        {sent && (
          <p role="status" className="rounded-md bg-surface-2 p-2.5 text-sm">
            If an account exists for that address, a reset link is on its way. It works for one hour.
          </p>
        )}
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create workspace'}
        </Button>
      </form>
      <p className="mt-4 space-y-1 text-center text-sm text-muted">
        {mode === 'login' && (
          <>
            <button className="block w-full underline hover:text-fg" onClick={() => { setMode('forgot'); setError(null); setSent(false); }}>
              Forgot your password?
            </button>
            {allowSignup && (
              <span className="block">
                New here?{' '}
                <button className="font-medium text-fg underline" onClick={() => { setMode('register'); setError(null); }}>
                  Create a workspace
                </button>
              </span>
            )}
          </>
        )}
        {mode !== 'login' && (
          <button className="font-medium text-fg underline" onClick={() => { setMode('login'); setError(null); }}>
            Back to sign in
          </button>
        )}
      </p>
    </Frame>
  );
}

/** /invite/:token: join an organization you were invited to. */
export function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const authUser = useApp((s) => s.authUser);
  const refreshSession = useApp((s) => s.refreshSession);
  const [invite, setInvite] = useState<{ orgName: string; email: string; role: Role; existingAccount: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getInvite(token)
      .then((i) => live && setInvite(i))
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : 'This invitation is not valid any more.'));
    return () => {
      live = false;
    };
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { orgSlug } = await api.acceptInvite(token, invite?.existingAccount ? {} : { name, password });
      await refreshSession();
      navigate(`/${orgSlug}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <Frame title="Invitation unavailable" subtitle={loadError}><Button onClick={() => navigate('/')}>Go to the app</Button></Frame>;
  if (!invite) return <Frame title="Loading invitation…">{null}</Frame>;

  const wrongAccount = invite.existingAccount && authUser?.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <Frame title={`Join ${invite.orgName}`} subtitle={`You were invited as ${ROLE_LABEL[invite.role]} (${invite.email}).`}>
      <form onSubmit={accept} className="space-y-4">
        {invite.existingAccount ? (
          wrongAccount ? (
            <>
              <p className="text-sm">An account for <b>{invite.email}</b> already exists. Sign in with it, then open this link again.</p>
              <Button type="button" onClick={() => navigate('/')}>Go to sign in</Button>
            </>
          ) : (
            <p className="text-sm">You're signed in as <b>{authUser?.email}</b>.</p>
          )
        ) : (
          <>
            <Field label="Your name">
              <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Choose a password" hint="At least 10 characters.">
              <Input required type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorLine message={error} />
        {!wrongAccount && (
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Joining…' : `Join ${invite.orgName}`}
          </Button>
        )}
      </form>
    </Frame>
  );
}

/** /reset/:token: choose a new password from the emailed link. */
export function ResetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <Frame title="Password changed" subtitle="You were signed out everywhere. Sign in with your new password.">
        <Button variant="primary" className="w-full" onClick={() => navigate('/', { replace: true })}>
          Go to sign in
        </Button>
      </Frame>
    );
  }
  return (
    <Frame title="Choose a new password">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.resetPassword(token, password);
            setDone(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not reset the password.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="New password" hint="At least 10 characters.">
          <Input required autoFocus type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          Change password
        </Button>
      </form>
    </Frame>
  );
}

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const notify = useApp((s) => s.notify);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-label="Change password"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.changePassword(current, next);
            notify('Password changed. Other devices were signed out.');
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not change the password.');
          } finally {
            setBusy(false);
          }
        }}
        className={cn('w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card')}
      >
        <h2 className="text-base font-semibold">Change password</h2>
        <Field label="Current password">
          <Input required autoFocus type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 10 characters. You'll stay signed in here; other devices are signed out.">
          <Input required type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <ErrorLine message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Change password
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Opened from the link at the bottom of an email. Asks first, so a mail scanner that merely opens the link changes nothing. */
export function Unsubscribe() {
  const { token = '' } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ask' | 'done' | 'bad'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .unsubscribeInfo(token)
      .then((r) => {
        setName(r.name);
        setState('ask');
      })
      .catch(() => setState('bad'));
  }, [token]);

  if (state === 'loading') return <Frame title="One moment…">{null}</Frame>;
  if (state === 'bad') return <Frame title="This link is not valid" subtitle="It may have been cut short when it was copied. You can change your email settings any time in the app: Inbox → Email settings." />;
  if (state === 'done') {
    return (
      <Frame title="You are unsubscribed" subtitle="ABG Tracker will no longer email you. Your Inbox in the app still works, and you can switch emails back on in Inbox → Email settings." />
    );
  }
  return (
    <Frame title="Stop these emails?" subtitle={`${name}, this stops every notification email from ABG Tracker to you, in all your organizations.`}>
      <ErrorLine message={error} />
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.unsubscribe(token);
            setState('done');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not unsubscribe. Please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Yes, stop the emails
      </Button>
    </Frame>
  );
}
