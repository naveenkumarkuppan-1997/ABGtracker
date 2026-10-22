import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { useApp } from '@/store/app';
import { scheduleConflicts } from '@/domain/dependencies';
import { isMilestoneType } from '@/domain/issueTypes';
import { isDone, statusOf, typeOf } from '@/domain/selectors';
import { applyDrag, fromDay, spanOf, todayDay, toDay, ZOOMS, type DragMode, type Span, type Zoom } from '@/domain/timeline';
import type { Issue } from '@/domain/types';
import { Avatar, Button, cn, EmptyState } from '@/components/ui';
import { TypeIcon } from '@/components/icons';
import { useProjectCtx } from './ProjectPage';

const ROW_H = 36;
const LEFT_W = 280;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Row {
  issue: Issue;
  depth: 0 | 1;
  span: Span | null;
  /** Span comes from children (container without own dates): not draggable. */
  derived: boolean;
}

interface DragState {
  id: string;
  mode: DragMode;
  delta: number;
}

export function TimelineView() {
  const { project, issues, allIssues, members, canEdit, openIssue } = useProjectCtx();
  const updateIssue = useApp((s) => s.updateIssue);
  const [zoom, setZoom] = useState<Zoom>('month');
  const [drag, setDrag] = useState<DragState | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = ZOOMS[zoom].px;
  const today = todayDay();

  // ---- rows -------------------------------------------------------------
  const { rows, unscheduled } = useMemo(() => {
    const shown = issues.filter((i) => typeOf(project, i.typeId)?.level !== 2);
    const ids = new Set(shown.map((i) => i.id));
    const level = (i: Issue) => typeOf(project, i.typeId)?.level ?? 1;
    const byStart = (a: Issue, b: Issue) => (spanOf(a)?.start ?? 1e9) - (spanOf(b)?.start ?? 1e9) || a.number - b.number;
    const containers = shown.filter((i) => level(i) === 0).sort(byStart);
    const out: Row[] = [];
    const placed = new Set<string>();

    const push = (issue: Issue, depth: 0 | 1, kids: Issue[] = []) => {
      let span = spanOf(issue);
      let derived = false;
      if (!span && kids.length) {
        const spans = kids.map(spanOf).filter((s): s is Span => !!s);
        if (spans.length) {
          span = { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
          derived = true;
        }
      }
      out.push({ issue, depth, span, derived });
      placed.add(issue.id);
    };

    for (const c of containers) {
      const kids = shown.filter((i) => i.parentId === c.id && level(i) === 1).sort(byStart);
      push(c, 0, kids);
      kids.forEach((k) => push(k, 1));
    }
    shown
      .filter((i) => !placed.has(i.id) && (!i.parentId || !ids.has(i.parentId) || level(i) === 0))
      .sort(byStart)
      .forEach((i) => push(i, 0));

    return { rows: out.filter((r) => r.span), unscheduled: out.filter((r) => !r.span).map((r) => r.issue) };
  }, [issues, project]);

  const spanFor = (r: Row): Span | null => {
    if (!r.span) return null;
    if (drag && drag.id === r.issue.id && !r.derived) {
      const a = applyDrag(r.span, drag.delta, drag.mode);
      return { start: toDay(a.startDate), end: toDay(a.dueDate) };
    }
    return r.span;
  };

  // ---- date range -------------------------------------------------------
  const [minDay, maxDay] = useMemo(() => {
    const all = rows.flatMap((r) => (r.span ? [r.span.start, r.span.end] : []));
    const lo = Math.min(today - 21, ...all) - 7;
    const hi = Math.max(today + 60, ...all) + 14;
    return [lo, hi];
  }, [rows, today]);
  const totalDays = maxDay - minDay + 1;
  const width = totalDays * px;
  const x = (day: number) => (day - minDay) * px;

  useEffect(() => {
    // Start slightly before today.
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - 160);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drag handling ------------------------------------------------------
  const beginDrag = (e: React.PointerEvent, r: Row, mode: DragMode) => {
    if (!canEdit || r.derived || !r.span) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let delta = 0;
    setDrag({ id: r.issue.id, mode, delta: 0 });
    const move = (ev: PointerEvent) => {
      delta = Math.round((ev.clientX - startX) / px);
      setDrag({ id: r.issue.id, mode, delta });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (delta === 0) {
        openIssue(r.issue.key);
        return;
      }
      const a = applyDrag(r.span!, delta, mode);
      const isMilestone = isMilestoneType(typeOf(project, r.issue.typeId));
      void updateIssue(r.issue.id, isMilestone ? { dueDate: a.dueDate } : { startDate: a.startDate, dueDate: a.dueDate });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- dependencies ---------------------------------------------------------
  const rowIndex = new Map(rows.map((r, i) => [r.issue.id, i]));
  const spanById = new Map(rows.map((r) => [r.issue.id, spanFor(r)]));
  const conflicts = scheduleConflicts(allIssues);
  const conflictKeys = new Set(conflicts.map((c) => `${c.issueId}:${c.blockerId}`));
  const visibleConflicts = conflicts.filter((c) => rowIndex.has(c.issueId));

  const arrows = rows.flatMap((r) =>
    r.issue.blockedBy.flatMap((bId) => {
      const from = spanById.get(bId);
      const to = spanById.get(r.issue.id);
      if (!from || !to) return [];
      const y1 = rowIndex.get(bId)! * ROW_H + ROW_H / 2;
      const y2 = rowIndex.get(r.issue.id)! * ROW_H + ROW_H / 2;
      const x1 = x(from.end + 1);
      const x2 = x(to.start);
      const bad = conflictKeys.has(`${r.issue.id}:${bId}`);
      const path =
        x2 >= x1 + 12
          ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2 - 2}`
          : `M${x1},${y1} H${x1 + 6} V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2 - 2}`;
      return [{ key: `${bId}-${r.issue.id}`, path, bad }];
    })
  );

  // ---- header ticks -----------------------------------------------------------
  const ticks = useMemo(() => {
    const months: { left: number; label: string }[] = [];
    const days: { left: number; label: string; weekend?: boolean }[] = [];
    for (let d = minDay; d <= maxDay; d++) {
      const date = new Date(d * 86400000);
      const dom = date.getUTCDate();
      if (dom === 1 || d === minDay) months.push({ left: (d - minDay) * px, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` });
      const dow = (d + 4) % 7; // 0 = Sunday
      if (zoom === 'week') days.push({ left: (d - minDay) * px, label: String(dom), weekend: dow === 0 || dow === 6 });
      else if (zoom === 'month' && dow === 1) days.push({ left: (d - minDay) * px, label: String(dom) });
    }
    return { months, days };
  }, [minDay, maxDay, px, zoom]);

  if (rows.length === 0 && unscheduled.length === 0) {
    return <EmptyState title="Nothing to show on the timeline" body="Add start or due dates to issues, or clear the filters." />;
  }

  const gridBg = zoom === 'week' ? `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${px}px)` : zoom === 'month' ? `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${px * 7}px)` : 'none';
  const gridOffset = zoom === 'month' ? ((((1 - (minDay + 4)) % 7) + 7) % 7) * px : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Zoom">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
              className={cn('px-3 py-1 text-xs', zoom === z ? 'bg-primary text-primary-fg' : 'hover:bg-surface-2')}
            >
              {ZOOMS[z].label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, x(today) - 160), behavior: 'smooth' })}>
          <CalendarDays size={13} /> Today
        </Button>
        <span className="text-xs text-muted">Drag a bar to reschedule · drag its edges to resize · click to open</span>
        {visibleConflicts.length > 0 && (
          <span role="status" className="ml-auto inline-flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">
            <AlertTriangle size={13} /> {visibleConflicts.length} scheduling conflict{visibleConflicts.length > 1 ? 's' : ''}: starts before a blocker is due
          </span>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div style={{ width: LEFT_W + width }} className="relative">
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: 44 }}>
            <div className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface px-3 py-2 text-xs font-medium text-muted" style={{ width: LEFT_W }}>
              Issue
            </div>
            <div className="relative" style={{ width }}>
              {ticks.months.map((m) => (
                <div key={m.left} className="absolute top-0 border-l border-line pl-1.5 pt-1 text-[11px] font-medium" style={{ left: m.left }}>
                  {m.label}
                </div>
              ))}
              {ticks.days.map((d) => (
                <div key={d.left} className={cn('absolute bottom-0.5 text-[10px] text-muted', d.weekend && 'opacity-50')} style={{ left: d.left + 2 }}>
                  {d.label}
                </div>
              ))}
            </div>
          </div>

          {/* rows */}
          <div className="relative">
            {rows.map((r) => {
              const span = spanFor(r)!;
              const type = typeOf(project, r.issue.typeId);
              const milestone = isMilestoneType(type);
              const done = isDone(project, r.issue);
              const cat = statusOf(project, r.issue.statusId)?.category;
              const fill = done ? 1 : cat === 'in_progress' ? 0.5 : 0;
              const left = x(span.start);
              const w = (span.end - span.start + 1) * px;
              const color = type?.color ?? '#3b82f6';
              const draggable = canEdit && !r.derived;
              return (
                <div key={r.issue.id} className="flex border-b border-line/60" style={{ height: ROW_H }}>
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                    style={{ width: LEFT_W, paddingLeft: 12 + r.depth * 18 }}
                  >
                    <TypeIcon type={type} size={13} />
                    <button onClick={() => openIssue(r.issue.key)} className="min-w-0 flex-1 truncate text-left text-sm hover:underline" title={r.issue.title}>
                      <span className="mr-1.5 text-xs text-muted">{r.issue.key}</span>
                      <span className={cn(done && 'text-muted line-through', r.depth === 0 && 'font-medium')}>{r.issue.title}</span>
                    </button>
                    <Avatar user={members.find((m) => m.id === r.issue.assigneeId)} size={18} />
                  </div>
                  <div className="relative" style={{ width, backgroundImage: gridBg, backgroundPositionX: gridOffset }}>
                    {milestone ? (
                      <button
                        aria-label={`${r.issue.key} milestone`}
                        title={`${r.issue.title} · ${fromDay(span.end)}`}
                        onPointerDown={(e) => beginDrag(e, r, 'move')}
                        onClick={(e) => e.detail === 0 && openIssue(r.issue.key)}
                        className={cn('absolute top-1/2 h-4 w-4 -translate-y-1/2 rotate-45 rounded-[3px] ring-2 ring-surface', draggable ? 'cursor-grab' : 'cursor-pointer')}
                        style={{ left: x(span.end) + px / 2 - 8, background: done ? '#2f9e6b' : color }}
                      />
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${r.issue.key} ${fromDay(span.start)} to ${fromDay(span.end)}`}
                        title={`${r.issue.title} · ${fromDay(span.start)} → ${fromDay(span.end)}`}
                        onPointerDown={(e) => (draggable ? beginDrag(e, r, 'move') : undefined)}
                        onClick={() => !draggable && openIssue(r.issue.key)}
                        onKeyDown={(e) => e.key === 'Enter' && openIssue(r.issue.key)}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-md',
                          r.depth === 0 && r.derived ? 'h-2.5' : 'h-5',
                          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          drag?.id === r.issue.id && 'ring-2 ring-accent'
                        )}
                        style={{ left, width: Math.max(w, 6), background: color + '55', border: `1px solid ${color}` }}
                      >
                        <div className="absolute inset-y-0 left-0" style={{ width: `${fill * 100}%`, background: color }} />
                        {draggable && w > 24 && (
                          <>
                            <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => beginDrag(e, r, 'start')} />
                            <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => beginDrag(e, r, 'end')} />
                          </>
                        )}
                      </div>
                    )}
                    {drag?.id === r.issue.id && (
                      <span className="pointer-events-none absolute top-0 -translate-y-0.5 rounded bg-fg px-1.5 py-0.5 text-[10px] text-bg" style={{ left: left + w + 6 }}>
                        {fromDay(span.start)} → {fromDay(span.end)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* today line + dependency arrows */}
            <div className="pointer-events-none absolute inset-y-0" style={{ left: LEFT_W, width }}>
              <div className="absolute inset-y-0 w-px bg-accent" style={{ left: x(today) + px / 2 }} title="Today" />
              <svg width={width} height={rows.length * ROW_H} className="absolute left-0 top-0" aria-hidden>
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <path
                    key={a.key}
                    d={a.path}
                    fill="none"
                    strokeWidth={1.5}
                    markerEnd="url(#arrow)"
                    className={a.bad ? 'text-danger' : 'text-muted'}
                    stroke="currentColor"
                    strokeDasharray={a.bad ? '4 3' : undefined}
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>

        {unscheduled.length > 0 && (
          <section className="border-t border-line bg-surface p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Unscheduled ({unscheduled.length})</h3>
            <ul className="space-y-1">
              {unscheduled.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <TypeIcon type={typeOf(project, i.typeId)} size={13} />
                  <button className="text-xs text-muted hover:underline" onClick={() => openIssue(i.key)}>
                    {i.key}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  {canEdit && (
                    <Button
                      size="sm"
                      onClick={() => void updateIssue(i.id, { startDate: fromDay(today), dueDate: fromDay(today + 4) })}
                    >
                      Schedule this week
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
