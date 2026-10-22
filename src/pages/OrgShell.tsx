import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Briefcase, Home as HomeIcon, Inbox, KeyRound, LogOut, Menu, Moon, Plus, RotateCcw, Search as SearchIcon, Settings as SettingsIcon, Sun, Users } from 'lucide-react';
import { BACKEND, useApp, useCan, useRole, useUnreadCount } from '@/store/app';
import { ChangePasswordDialog } from '@/pages/AuthPages';
import { ROLE_LABEL } from '@/domain/permissions';
import { Avatar, Button, cn, Select } from '@/components/ui';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { CopilotButton } from '@/components/Copilot';

export function OrgShell() {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const orgs = useApp((s) => s.orgs);
  const data = useApp((s) => s.data);
  const selectOrg = useApp((s) => s.selectOrg);
  const toast = useApp((s) => s.toast);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const org = orgs.find((o) => o.slug === orgSlug);

  useEffect(() => {
    setError(null);
    if (!org) return;
    selectOrg(org.id).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'));
  }, [org?.id, selectOrg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNavOpen(false);
  }, [orgSlug]);

  if (!org) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Organization not found</h1>
          <p className="mt-1 text-sm text-muted">You don't have access to “{orgSlug}”.</p>
          <Button className="mt-4" variant="primary" onClick={() => navigate('/')}>
            Go to my workspace
          </Button>
        </div>
      </div>
    );
  }
  if (error) return <div className="p-10 text-danger">{error}</div>;
  if (!data || data.org.id !== org.id) return <div className="grid h-full place-items-center text-muted">Loading…</div>;

  return (
    <div className="flex h-full">
      <div className={cn('fixed inset-0 z-30 bg-black/40 md:hidden', navOpen ? 'block' : 'hidden')} onClick={() => setNavOpen(false)} />
      <Sidebar className={cn('fixed z-40 h-full md:static', navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0')} />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        <div className="flex h-12 items-center gap-2 border-b border-line bg-surface px-3 md:hidden">
          <button aria-label="Open navigation" onClick={() => setNavOpen(true)} className="rounded p-1.5 hover:bg-surface-2">
            <Menu size={18} />
          </button>
          <span className="font-semibold">{data.org.name}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      <CopilotButton />
      {/* The announcing region exists all the time, so screen readers read each message as it appears. */}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
        {toast && <div className="rounded-lg bg-fg px-4 py-2.5 text-sm text-bg shadow-card">{toast.message}</div>}
      </div>
    </div>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', isActive ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-2 hover:text-fg');

function Sidebar({ className }: { className?: string }) {
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const signOut = useApp((s) => s.signOut);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { orgs, data, userId, theme } = useApp();
  const switchUser = useApp((s) => s.switchUser);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const resetDemo = useApp((s) => s.resetDemo);
  const canCreate = useCan('project.create');
  const role = useRole();
  const [creating, setCreating] = useState(false);
  if (!data) return null;
  const me = data.members.find((m) => m.id === userId);

  return (
    <aside className={cn('sidebar-theme flex w-64 shrink-0 flex-col border-r border-line bg-surface text-fg transition-transform', className)}>
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-fg">A</span>
          <span className="font-semibold">ABG Tracker</span>
        </div>
        <Select
          aria-label="Organization"
          value={data.org.slug}
          onChange={(e) => navigate(`/${e.target.value}`)}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.slug}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        <NavLink
          to={`/${data.org.slug}`}
          end
          className={navClass}
        >
          <HomeIcon size={15} /> Home
        </NavLink>
        <NavLink to={`/${data.org.slug}/portfolio`} className={navClass}>
          <Briefcase size={15} /> Portfolio
        </NavLink>
        <NavLink to={`/${data.org.slug}/inbox`} className={navClass}>
          <Inbox size={15} /> Inbox
          {unread > 0 && (
            <span aria-label={`${unread} unread`} className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold text-black">
              {unread}
            </span>
          )}
        </NavLink>
        <NavLink to={`/${data.org.slug}/search`} className={navClass}>
          <SearchIcon size={15} /> Search
        </NavLink>
        <NavLink to={`/${data.org.slug}/members`} className={navClass}>
          <Users size={15} /> People
        </NavLink>
        <NavLink to={`/${data.org.slug}/settings`} className={navClass}>
          <SettingsIcon size={15} /> Settings
        </NavLink>

        <div>
          <div className="mb-1 flex items-center justify-between px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Projects
            {canCreate && (
              <button aria-label="New project" onClick={() => setCreating(true)} className="rounded p-0.5 hover:bg-surface-2 hover:text-fg">
                <Plus size={14} />
              </button>
            )}
          </div>
          {data.projects.length === 0 && <p className="px-2.5 text-xs text-muted">No projects yet.</p>}
          {data.projects.map((p) => (
            <NavLink
              key={p.id}
              to={`/${data.org.slug}/p/${p.key}`}
              className={({ isActive }) =>
                cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', isActive ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-2 hover:text-fg')
              }
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto text-[10px] text-muted">{p.key}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex items-center gap-2">
          <Avatar user={me} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me?.name}</div>
            <div className="text-xs text-muted">{role ? ROLE_LABEL[role] : ''} · {data.org.plan}</div>
          </div>
          <button aria-label="Toggle theme" onClick={toggleTheme} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        {BACKEND === 'local' ? (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">Demo tools</summary>
            <div className="mt-2 space-y-2">
              <label className="block">
                Act as
                <Select value={userId} onChange={(e) => void switchUser(e.target.value)} className="mt-1">
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({ROLE_LABEL[m.role]})
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                size="sm"
                className="w-full"
                onClick={async () => {
                  if (confirm('Reset all demo data?')) {
                    await resetDemo();
                    navigate('/');
                  }
                }}
              >
                <RotateCcw size={12} /> Reset demo data
              </Button>
            </div>
          </details>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => navigate(`/${data.org.slug}/settings?tab=account`)}>
              <KeyRound size={12} /> Account
            </Button>
            <Button size="sm" className="flex-1" onClick={() => void signOut()}>
              <LogOut size={12} /> Sign out
            </Button>
          </div>
        )}
      </div>
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
    </aside>
  );
}
