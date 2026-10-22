import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BACKEND, useApp } from '@/store/app';
import { AcceptInvite, AuthScreen, ResetPassword, Unsubscribe } from '@/pages/AuthPages';
import { DialogManager, SkipLink } from '@/components/A11y';
import { OrgShell } from '@/pages/OrgShell';
import { Home } from '@/pages/Home';
import { ProjectPage } from '@/pages/ProjectPage';
import { BoardView } from '@/pages/BoardView';

// The first screens people see load with the app; the rest are fetched the first time they are opened, so the first page stays small and fast.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Members = page(() => import('@/pages/Members'), 'Members');
const ListView = page(() => import('@/pages/ListView'), 'ListView');
const ProjectSettings = page(() => import('@/pages/ProjectSettings'), 'ProjectSettings');
const BacklogGate = page(() => import('@/pages/BacklogView'), 'BacklogGate');
const TimelineView = page(() => import('@/pages/TimelineView'), 'TimelineView');
const InsightsView = page(() => import('@/pages/InsightsView'), 'InsightsView');
const AutomationView = page(() => import('@/pages/AutomationView'), 'AutomationView');
const FormsView = page(() => import('@/pages/FormsView'), 'FormsView');
const PublicForm = page(() => import('@/pages/PublicForm'), 'PublicForm');
const Portfolio = page(() => import('@/pages/Portfolio'), 'Portfolio');
const Inbox = page(() => import('@/pages/Inbox'), 'Inbox');
const Search = page(() => import('@/pages/Search'), 'Search');
const SettingsPage = page(() => import('@/pages/SettingsPage'), 'SettingsPage');
function RootRedirect() {
  const orgs = useApp((s) => s.orgs);
  if (!orgs.length) return <div className="p-10 text-muted">You are not a member of any organization.</div>;
  return <Navigate to={`/${orgs[0].slug}`} replace />;
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const authUser = useApp((s) => s.authUser);
  const { pathname } = useLocation();
  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) return <div className="grid h-full place-items-center text-muted">Loading…</div>;

  // On the real server everything except public forms and invitations needs a signed-in account.
  const isPublicPath = ['/forms/', '/invite/', '/reset/', '/unsubscribe/'].some((p) => pathname.startsWith(p));
  if (BACKEND === 'api' && !authUser && !isPublicPath) return <AuthScreen />;

  return (
    <>
    <SkipLink />
    <DialogManager />
    <Suspense fallback={<div className="grid h-full place-items-center p-10 text-muted" role="status">Loading…</div>}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      {/* Public, signed-out access (outside the app shell) */}
      <Route path="/forms/:orgSlug/:formSlug" element={<PublicForm />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/unsubscribe/:token" element={<Unsubscribe />} />
      <Route path="/:orgSlug" element={<OrgShell />}>
        <Route index element={<Home />} />
        <Route path="p/:projectKey" element={<ProjectPage />}>
          <Route index element={<Navigate to="board" replace />} />
          <Route path="board" element={<BoardView />} />
          <Route path="backlog" element={<BacklogGate />} />
          <Route path="timeline" element={<TimelineView />} />
          <Route path="list" element={<ListView />} />
          <Route path="insights" element={<InsightsView />} />
          <Route path="automation" element={<AutomationView />} />
          <Route path="forms" element={<FormsView />} />
          <Route path="settings" element={<ProjectSettings />} />
        </Route>
        <Route path="members" element={<Members />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="search" element={<Search />} />
        <Route path="*" element={<div className="p-10 text-muted">Page not found.</div>} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
