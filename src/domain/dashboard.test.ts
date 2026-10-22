import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/data/localRepository';
import { computeDashboard, defaultLayout, MAX_WIDGETS, normalizeLayout, validateLayout, WIDGETS } from './dashboard';
import type { DashboardLayout } from './types';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let repo: LocalRepository;
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  repo = new LocalRepository();
});

describe('dashboard layout', () => {
  it('starts with a sensible default for each role', () => {
    const all = defaultLayout('admin');
    expect(all.widgets.map((w) => w.id)).toEqual(WIDGETS.map((w) => w.id));
    expect(all.widgets.find((w) => w.id === 'mine')!.visible).toBe(true);
    expect(all.widgets.find((w) => w.id === 'health')!.visible).toBe(false); // the slow one is opt-in
    const guest = defaultLayout('guest').widgets.filter((w) => w.visible).map((w) => w.id);
    expect(guest).toEqual(['mine', 'dueSoon', 'approvals', 'activity']); // guests only see what is about them
    expect(all.widgets.find((w) => w.id === 'briefing')!.visible).toBe(true); // shown when an assistant exists (the screen hides it otherwise)
    expect(all.widgets[1].id).toBe('briefing'); // right under the tiles
    expect(guest).not.toContain('workload');
  });

  it('repairs old or damaged layouts and never hides new widgets', () => {
    const odd = { widgets: [{ id: 'activity', visible: true, size: 'huge' }, { id: 'nonsense', visible: true, size: 'half' }, { id: 'mine', visible: false, size: 'full' }, { id: 'activity', visible: false, size: 'half' }] };
    const out = normalizeLayout(odd, 'member');
    expect(out.widgets.slice(0, 2)).toEqual([{ id: 'activity', visible: true, size: 'full' }, { id: 'mine', visible: false, size: 'full' }]); // order kept, bad size repaired, repeat and unknown dropped
    expect(out.widgets.map((w) => w.id).sort()).toEqual(WIDGETS.map((w) => w.id).sort()); // everything that exists is there
    expect(normalizeLayout(null, 'member')).toEqual(defaultLayout('member'));
    expect(normalizeLayout({ widgets: 'x' }, 'member')).toEqual(defaultLayout('member'));
  });

  it('accepts only well-formed layouts when saving', () => {
    const good: DashboardLayout = { widgets: [{ id: 'mine', visible: true, size: 'half' }, { id: 'kpis', visible: false, size: 'full' }] };
    expect(validateLayout(good).widgets[0]).toEqual({ id: 'mine', visible: true, size: 'half' });
    const bad: unknown[] = [null, {}, { widgets: [] }, { widgets: [{ id: 'mine', visible: 'yes', size: 'half' }] }, { widgets: [{ id: 'evil', visible: true, size: 'half' }] }, { widgets: [{ id: 'mine', visible: true, size: 'tiny' }] }, { widgets: [good.widgets[0], good.widgets[0]] }, { widgets: Array(MAX_WIDGETS + 1).fill(good.widgets[0]) }];
    for (const b of bad) expect(() => validateLayout(b), JSON.stringify(b)?.slice(0, 50)).toThrow(/not valid/);
  });
});

describe('dashboard numbers', () => {
  const load = (org = 'org_acme', user = 'u_alex') => repo.loadOrg(org, user);

  it('counts open, overdue and blocked work, and mine, from what is loaded', async () => {
    const d = await load();
    const s = computeDashboard(d, 'u_alex', new Date('2026-10-12T12:00:00'));
    expect(s.kpis.open).toBeGreaterThan(0);
    expect(s.kpis.overdue).toBeLessThanOrEqual(s.kpis.open);
    expect(s.kpis.blocked).toBeLessThanOrEqual(s.kpis.open);
    expect(s.kpis.myOpen).toBe(s.mine.length);
    expect(s.mine.every((r) => r.issue.assigneeId === 'u_alex')).toBe(true);
    expect([...s.mine].map((r) => r.issue.dueDate ?? '9999')).toEqual([...s.mine].map((r) => r.issue.dueDate ?? '9999').sort()); // soonest first
    expect(s.stage.todo + s.stage.in_progress + s.stage.done).toBeGreaterThan(s.kpis.open - 1);
    expect(Object.values(s.priority).reduce((a, b) => a + b, 0)).toBe(s.kpis.open);
    expect(s.trend.labels).toHaveLength(6);
    expect(s.activity.length).toBeLessThanOrEqual(12);
  });

  it('gives every tile the exact items it counted, so number and list always agree', async () => {
    const d = await load();
    const project = d.projects[0];
    const mineOpen = d.issues.filter((i) => i.projectId === project.id && i.assigneeId === 'u_alex' && project.statuses.find((x) => x.id === i.statusId)?.category !== 'done');
    if (mineOpen[0]) mineOpen[0].dueDate = '2026-10-01'; // make sure something is overdue
    const s = computeDashboard(d, 'u_alex', new Date('2026-10-12T09:00:00'));
    for (const id of ['open', 'overdue', 'blocked', 'doneThisWeek', 'myOpen', 'myOverdue'] as const) expect(s.kpis[id], id).toBe(s.tiles[id].length);
    const openIds = new Set(s.tiles.open.map((r) => r.issue.id));
    expect(s.tiles.overdue.every((r) => openIds.has(r.issue.id) && r.issue.dueDate! < '2026-10-12')).toBe(true);
    expect(s.tiles.blocked.every((r) => openIds.has(r.issue.id))).toBe(true);
    expect(s.tiles.myOverdue.every((r) => r.issue.assigneeId === 'u_alex' && r.issue.dueDate! < '2026-10-12')).toBe(true);
    expect(s.tiles.myOpen.map((r) => r.issue.id)).toEqual(s.mine.map((r) => r.issue.id));
    expect(s.tiles.overdue.map((r) => r.issue.dueDate)).toEqual([...s.tiles.overdue.map((r) => r.issue.dueDate)].sort()); // longest overdue first
  });

  it('narrows every number to one project', async () => {
    const d = await load();
    const all = computeDashboard(d, 'u_alex', new Date());
    const one = d.projects[0];
    const s = computeDashboard(d, 'u_alex', new Date(), one.id);
    expect(s.kpis.open).toBeLessThanOrEqual(all.kpis.open);
    expect([...s.mine, ...s.dueSoon, ...s.upcoming, ...s.approvals, ...s.watching].every((r) => r.project.id === one.id)).toBe(true);
    expect(s.activity.every((a) => a.projectId === one.id)).toBe(true);
    expect(computeDashboard(d, 'u_alex', new Date(), 'p_missing').kpis.open).toBe(0);
  });

  it('shows deadlines by the clock it is given, and only unfinished work', async () => {
    const d = await load();
    const project = d.projects[0];
    const open = d.issues.find((i) => i.projectId === project.id && i.assigneeId === 'u_alex' && project.statuses.find((x) => x.id === i.statusId)?.category !== 'done')!;
    open.dueDate = '2026-10-10';
    const s = computeDashboard(d, 'u_alex', new Date('2026-10-12T09:00:00'));
    const row = s.dueSoon.find((r) => r.issue.id === open.id)!;
    expect(row).toBeDefined(); // already late, so it is first in line
    expect(s.dueSoon.indexOf(row)).toBe(0);
    expect(s.kpis.myOverdue).toBeGreaterThanOrEqual(1);
    open.dueDate = '2026-10-18'; // within a week
    expect(computeDashboard(d, 'u_alex', new Date('2026-10-12T09:00:00')).dueSoon.some((r) => r.issue.id === open.id)).toBe(true);
    open.dueDate = '2026-11-30'; // far away
    expect(computeDashboard(d, 'u_alex', new Date('2026-10-12T09:00:00')).dueSoon.some((r) => r.issue.id === open.id)).toBe(false);
    open.statusId = project.statuses.find((x) => x.category === 'done')!.id; // finished work is no deadline
    open.dueDate = '2026-10-10';
    expect(computeDashboard(d, 'u_alex', new Date('2026-10-12T09:00:00')).mine.some((r) => r.issue.id === open.id)).toBe(false);
  });

  it('lists what I follow and what waits for my sign-off', async () => {
    const d = await load();
    const target = d.issues.find((i) => i.projectId === d.projects[0].id)!;
    target.watcherIds = ['u_alex'];
    expect(computeDashboard(d, 'u_alex').watching.some((r) => r.issue.id === target.id) || d.projects[0].statuses.find((x) => x.id === target.statusId)?.category === 'done').toBe(true);
    expect(computeDashboard(d, 'u_sam').watching.some((r) => r.issue.id === target.id)).toBe(false);
  });
});

describe('saving a layout', () => {
  it('keeps it private to the person, validates it, and can reset it', async () => {
    const layout: DashboardLayout = { widgets: [{ id: 'activity', visible: true, size: 'full' }, { id: 'mine', visible: false, size: 'half' }] };
    const saved = await repo.setDashboardLayout(layout, 'u_alex');
    expect(saved.dashboard!.widgets.map((w) => w.id)).toContain('kpis'); // completed with the rest
    expect(saved.dashboard!.widgets[0].id).toBe('activity');
    const members = (await repo.loadOrg('org_acme', 'u_priya')).members;
    expect(JSON.stringify(members)).not.toContain('"dashboard"'); // nobody else sees how you arranged it
    await expect(repo.setDashboardLayout({ widgets: [{ id: 'evil', visible: true, size: 'half' }] } as unknown as DashboardLayout, 'u_alex')).rejects.toThrow(/not valid/);
    expect((await repo.setDashboardLayout(null, 'u_alex')).dashboard).toBeUndefined();
    await expect(repo.setDashboardLayout(layout, 'u_nobody')).rejects.toThrow(/not found/);
  });
});
