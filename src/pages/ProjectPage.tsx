import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, FileInput, GanttChart, Layers, LayoutGrid, List, Plus, Search, Settings, Zap } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { compileQuery, looksLikeQuery } from '@/domain/query';
import { SavedFilters } from '@/components/FilterBar';
import { FieldsMenu, useVisibleFields } from '@/components/FieldsMenu';
import { ImportCsv } from '@/components/ImportCsv';
import { TEMPLATES } from '@/domain/templates';
import type { CustomFieldDef, Issue, Member, Project, Sprint } from '@/domain/types';
import { Badge, Button, cn, Input, Select } from '@/components/ui';
import { CreateIssueModal } from '@/components/CreateIssueModal';
import { IssueDetail } from '@/components/IssueDetail';

export interface ProjectCtx {
  project: Project;
  /** All issues of the project (unfiltered). */
  allIssues: Issue[];
  /** Issues after applying the toolbar filters. */
  issues: Issue[];
  sprints: Sprint[];
  /** Custom fields the viewer chose to see on cards and in the list. */
  visibleFields: CustomFieldDef[];
  members: Member[];
  canEdit: boolean;
  openIssue: (key: string) => void;
}

export const useProjectCtx = () => useOutletContext<ProjectCtx>();

export function ProjectPage() {
  const { projectKey } = useParams();
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const canEdit = useCan('issue.edit');
  const canCreate = useCan('issue.create');
  const canManage = useCan('project.manage');
  const canAutomate = useCan('automation.manage');
  const [params, setParams] = useSearchParams();
  const path = useLocation().pathname;
  const onSettings = ['/settings', '/insights', '/automation', '/forms'].some((s) => path.endsWith(s));
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [typeId, setTypeId] = useState('all');
  const [creating, setCreating] = useState(false);

  const project = data.projects.find((p) => p.key === projectKey);
  const [visibleFieldIds, toggleField, showField] = useVisibleFields(project);
  const allIssues = useMemo(() => data.issues.filter((i) => i.projectId === project?.id), [data.issues, project?.id]);

  // The search box accepts plain words or a query ("priority >= high AND assignee = me").
  const compiled = useMemo(() => {
    if (!project || !looksLikeQuery(search)) return null;
    return compileQuery(search, { userId, members: data.members, projects: [project], issues: data.issues, sprints: data.sprints });
  }, [search, project, userId, data.members, data.issues, data.sprints]);
  const queryError = compiled && !compiled.ok ? compiled.error : null;

  const issues = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allIssues.filter((i) => {
      if (compiled) {
        if (compiled.ok && !compiled.match(i)) return false;
      } else if (q && !(i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q) || i.labels.some((l) => l.toLowerCase().includes(q)))) return false;
      if (assignee === 'me' && i.assigneeId !== userId) return false;
      if (assignee === 'none' && i.assigneeId) return false;
      if (assignee !== 'all' && assignee !== 'me' && assignee !== 'none' && i.assigneeId !== assignee) return false;
      if (typeId !== 'all' && i.typeId !== typeId) return false;
      return true;
    });
    return compiled?.ok && compiled.compare ? list.sort(compiled.compare) : list;
  }, [allIssues, search, compiled, assignee, typeId, userId]);

  if (!project) return <div className="p-10 text-muted">Project “{projectKey}” not found.</div>;

  const openKey = params.get('issue');
  const openIssue = (key: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('issue', key);
      return n;
    });
  const closeIssue = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('issue');
      return n;
    });

  const tab = (to: string, label: string, Icon: typeof List) => (
    <NavLink
      to={{ pathname: to, search: params.toString() ? `?${params.toString()}` : '' }}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
          isActive ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-fg'
        )
      }
    >
      <Icon size={14} /> {label}
    </NavLink>
  );

  const sprints = data.sprints.filter((s) => s.projectId === project.id);
  const visibleFields = project.customFields.filter((f) => visibleFieldIds.includes(f.id));
  const showFieldsMenu = ['/board', '/list', '/backlog'].some((s) => path.endsWith(s));
  const ctx: ProjectCtx = { project, allIssues, issues, sprints, visibleFields, members: data.members, canEdit, openIssue };
  const filtered = issues.length !== allIssues.length;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface px-6 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="h-4 w-4 rounded" style={{ background: project.color }} />
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <Badge>{project.key}</Badge>
          <Badge>{TEMPLATES[project.workStyle].label}</Badge>
          <div className="ml-auto">
            {canCreate && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> Create issue
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex">
            {tab('board', 'Board', LayoutGrid)}
            {project.workStyle === 'agile' && tab('backlog', 'Backlog', Layers)}
            {tab('list', 'List', List)}
            {tab('timeline', 'Timeline', GanttChart)}
            {tab('insights', 'Insights', BarChart3)}
            {canAutomate && tab('automation', 'Automation', Zap)}
            {canManage && tab('forms', 'Forms', FileInput)}
            {canManage && tab('settings', 'Settings', Settings)}
          </div>
          <div className={cn('flex-wrap items-center gap-2 pb-2', onSettings ? 'hidden' : 'flex')}>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
              <Input
                aria-label="Search issues"
                aria-invalid={!!queryError}
                title='Plain words, or a query like: priority >= high AND assignee = me'
                className={cn('w-56 pl-8', queryError && 'border-danger')}
                placeholder="Search or query…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <SavedFilters query={search} onApply={setSearch} canSave={looksLikeQuery(search) && !queryError} />
            <Select aria-label="Filter by assignee" className="w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="all">All assignees</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by type" className="w-36" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="all">All types</option>
              {project.issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {showFieldsMenu && <FieldsMenu project={project} visible={visibleFieldIds} onToggle={toggleField} onShow={showField} />}
            {showFieldsMenu && <ImportCsv project={project} />}
            {(filtered || search || assignee !== 'all' || typeId !== 'all') && (
              <button
                className="text-xs text-muted underline hover:text-fg"
                onClick={() => {
                  setSearch('');
                  setAssignee('all');
                  setTypeId('all');
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </header>

      {queryError && (
        <div role="alert" className="border-b border-line bg-danger/10 px-6 py-1.5 text-xs text-danger">
          Query error: {queryError}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet context={ctx} />
      </div>

      {creating && <CreateIssueModal project={project} onClose={() => setCreating(false)} onCreated={(k) => openIssue(k)} />}
      {openKey && <IssueDetail project={project} issueKey={openKey} onClose={closeIssue} onOpen={openIssue} />}
    </div>
  );
}
