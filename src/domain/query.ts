// A small, safe query language for issues (JQL-lite).
//
//   status = "In Progress" AND assignee = me AND priority >= high
//   (label = api OR label = security) AND due < 7d ORDER BY priority DESC
//   type in (Bug, Story) AND assignee is empty
//   payment gateway            <- bare words search title/description/key/labels
//
// Fields: status, statusCategory, type, assignee, reporter, priority, label, project,
// key, parent, sprint (name or active/planned/completed), approval (pending/approved/rejected),
// due, start, created, updated, resolved, estimate, text, plus any custom field by name.
// Operators: = != ~ > >= < <=  in (...)  is [not] empty    Combine with AND / OR / NOT and ( ).

import { approvalState } from './approvals';
import type { FieldValue, Issue, Member, Project, Sprint } from './types';

export interface QueryContext {
  userId: string;
  members: Pick<Member, 'id' | 'name' | 'email'>[];
  projects: Project[];
  /** Needed only for the `parent` field. */
  issues?: Issue[];
  /** Needed only for the `sprint` field. */
  sprints?: Sprint[];
  now?: Date;
}

export type CompiledQuery =
  | { ok: true; match: (issue: Issue) => boolean; compare?: (a: Issue, b: Issue) => number }
  | { ok: false; error: string };

class QueryError extends Error {}

type Tok = { t: 'word' | 'str' | 'op' | 'lp' | 'rp' | 'comma'; v: string };

const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '(') {
      out.push({ t: 'lp', v: c });
      i++;
    } else if (c === ')') {
      out.push({ t: 'rp', v: c });
      i++;
    } else if (c === ',') {
      out.push({ t: 'comma', v: c });
      i++;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new QueryError('Unterminated quote.');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if ('!=<>~'.includes(c)) {
      const two = src.slice(i, i + 2);
      if (['!=', '>=', '<='].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if (c === '!') {
        throw new QueryError('Unexpected "!". Did you mean "!="?');
      } else {
        out.push({ t: 'op', v: c });
        i++;
      }
    } else {
      let j = i;
      while (j < src.length && !/[\s(),"'=!<>~]/.test(src[j])) j++;
      out.push({ t: 'word', v: src.slice(i, j) });
      i = j;
    }
  }
  return out;
}

// ---- dates -----------------------------------------------------------------

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function resolveDate(v: string, now: Date): string {
  const s = v.trim().toLowerCase();
  const shift = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return ymd(d);
  };
  if (s === 'today') return shift(0);
  if (s === 'tomorrow') return shift(1);
  if (s === 'yesterday') return shift(-1);
  const rel = /^([+-]?)(\d+)([dw])$/.exec(s);
  if (rel) return shift((rel[1] === '-' ? -1 : 1) * Number(rel[2]) * (rel[3] === 'w' ? 7 : 1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new QueryError(`"${v}" is not a date. Use 2025-01-31, today, tomorrow, 7d or -2w.`);
}

// ---- field definitions -----------------------------------------------------

type Kind = 'text' | 'status' | 'user' | 'priority' | 'date' | 'number' | 'list';
type Raw = string | number | string[] | null | undefined;

interface FieldDef {
  kind: Kind;
  get: (issue: Issue) => Raw;
}

const EMPTY_WORDS = new Set(['empty', 'unassigned', 'none', 'null']);

function resolveField(name: string, ctx: QueryContext): FieldDef {
  const n = name.toLowerCase();
  const proj = (i: Issue) => ctx.projects.find((p) => p.id === i.projectId);
  const dateOnly = (s?: string) => (s ? s.slice(0, 10) : undefined);

  switch (n) {
    case 'status':
      return {
        kind: 'status',
        get: (i) => {
          const s = proj(i)?.statuses.find((x) => x.id === i.statusId);
          return s ? [s.name, s.id] : [i.statusId];
        },
      };
    case 'statuscategory':
    case 'category':
      return { kind: 'text', get: (i) => proj(i)?.statuses.find((x) => x.id === i.statusId)?.category };
    case 'type':
      return {
        kind: 'list',
        get: (i) => {
          const t = proj(i)?.issueTypes.find((x) => x.id === i.typeId);
          return t ? [t.name, t.id] : [i.typeId];
        },
      };
    case 'sprint':
      return {
        kind: 'list',
        get: (i) => {
          const s = i.sprintId ? ctx.sprints?.find((x) => x.id === i.sprintId) : undefined;
          return s ? [s.name, s.state] : undefined;
        },
      };
    case 'approval':
      return {
        kind: 'text',
        get: (i) => (i.approval ? approvalState(i.approval) : undefined),
      };
    case 'assignee':
      return { kind: 'user', get: (i) => i.assigneeId };
    case 'reporter':
      return { kind: 'user', get: (i) => i.reporterId };
    case 'priority':
      return { kind: 'priority', get: (i) => i.priority };
    case 'label':
    case 'labels':
      return { kind: 'list', get: (i) => i.labels };
    case 'project':
      return { kind: 'list', get: (i) => [proj(i)?.key ?? '', proj(i)?.name ?? ''] };
    case 'key':
      return { kind: 'text', get: (i) => i.key };
    case 'parent':
      return { kind: 'text', get: (i) => (i.parentId ? ctx.issues?.find((x) => x.id === i.parentId)?.key : undefined) };
    case 'due':
      return { kind: 'date', get: (i) => i.dueDate };
    case 'start':
      return { kind: 'date', get: (i) => i.startDate };
    case 'created':
      return { kind: 'date', get: (i) => dateOnly(i.createdAt) };
    case 'updated':
      return { kind: 'date', get: (i) => dateOnly(i.updatedAt) };
    case 'resolved':
      return { kind: 'date', get: (i) => dateOnly(i.resolvedAt) };
    case 'estimate':
    case 'points':
      return { kind: 'number', get: (i) => i.estimate };
    case 'summary':
    case 'title':
      return { kind: 'text', get: (i) => i.title };
    case 'description':
      return { kind: 'text', get: (i) => i.description };
    case 'text':
      return { kind: 'text', get: (i) => `${i.key} ${i.title} ${i.description} ${i.labels.join(' ')}` };
  }

  // Custom field by name (matched per project, so same-named fields work across projects).
  const first = ctx.projects.flatMap((p) => p.customFields).find((f) => f.name.toLowerCase() === n);
  if (!first) throw new QueryError(`Unknown field "${name}".`);
  const kind: Kind =
    first.type === 'number' ? 'number' : first.type === 'date' ? 'date' : first.type === 'person' ? 'user' : first.type === 'multiselect' ? 'list' : 'text';
  return {
    kind,
    get: (i) => {
      const def = proj(i)?.customFields.find((f) => f.name.toLowerCase() === n);
      if (!def) return undefined;
      const v: FieldValue | undefined = i.customFields[def.id];
      if (v === undefined || v === null) return undefined;
      return typeof v === 'boolean' ? String(v) : v;
    },
  };
}

// ---- parser / compiler -----------------------------------------------------

type Pred = (i: Issue) => boolean;

const isEmpty = (r: Raw) => r === undefined || r === null || r === '' || (Array.isArray(r) && r.length === 0);
const low = (s: string) => s.toLowerCase();

export function compileQuery(src: string, ctx: QueryContext): CompiledQuery {
  try {
    return compile(src, ctx);
  } catch (e) {
    if (e instanceof QueryError) return { ok: false, error: e.message };
    throw e;
  }
}

function compile(src: string, ctx: QueryContext): CompiledQuery {
  const toks = tokenize(src);
  let pos = 0;
  const now = ctx.now ?? new Date();
  const peek = (o = 0) => toks[pos + o];
  const isKw = (t: Tok | undefined, kw: string) => !!t && t.t === 'word' && low(t.v) === kw;
  const next = () => toks[pos++];

  const userIds = (v: string): Set<string> => {
    if (low(v) === 'me') return new Set([ctx.userId]);
    const exact = ctx.members.filter((m) => [m.id, m.name, m.email].some((x) => low(x) === low(v)));
    const found = exact.length ? exact : ctx.members.filter((m) => low(m.name).includes(low(v)));
    if (!found.length) throw new QueryError(`No user matches "${v}".`);
    return new Set(found.map((m) => m.id));
  };

  const eqTest = (def: FieldDef, v: string): Pred => {
    switch (def.kind) {
      case 'user': {
        if (EMPTY_WORDS.has(low(v))) return (i) => isEmpty(def.get(i));
        const ids = userIds(v);
        return (i) => ids.has(String(def.get(i)));
      }
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new QueryError(`"${v}" is not a number.`);
        return (i) => def.get(i) === n;
      }
      case 'date': {
        if (EMPTY_WORDS.has(low(v))) return (i) => isEmpty(def.get(i));
        const d = resolveDate(v, now);
        return (i) => def.get(i) === d;
      }
      case 'priority': {
        if (!(low(v) in PRIORITY_RANK)) throw new QueryError(`Unknown priority "${v}". Use critical, high, medium or low.`);
        return (i) => def.get(i) === low(v);
      }
      case 'status':
      case 'list': {
        if (EMPTY_WORDS.has(low(v))) return (i) => isEmpty(def.get(i));
        return (i) => {
          const r = def.get(i);
          return Array.isArray(r) && r.some((x) => low(x) === low(v));
        };
      }
      default: {
        if (EMPTY_WORDS.has(low(v))) return (i) => isEmpty(def.get(i));
        return (i) => {
          const r = def.get(i);
          return typeof r === 'string' && low(r) === low(v);
        };
      }
    }
  };

  const containsTest = (def: FieldDef, v: string): Pred => {
    if (def.kind === 'number' || def.kind === 'date' || def.kind === 'priority') {
      throw new QueryError('"~" works on text, labels, status and people only.');
    }
    if (def.kind === 'user') {
      const ids = new Set(ctx.members.filter((m) => low(m.name).includes(low(v))).map((m) => m.id));
      return (i) => ids.has(String(def.get(i)));
    }
    return (i) => {
      const r = def.get(i);
      if (Array.isArray(r)) return r.some((x) => low(x).includes(low(v)));
      return typeof r === 'string' && low(r).includes(low(v));
    };
  };

  const compareTest = (def: FieldDef, op: string, v: string, field: string): Pred => {
    const cmp = (a: number | string, b: number | string) =>
      op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
    if (def.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new QueryError(`"${v}" is not a number.`);
      return (i) => typeof def.get(i) === 'number' && cmp(def.get(i) as number, n);
    }
    if (def.kind === 'date') {
      const d = resolveDate(v, now);
      return (i) => typeof def.get(i) === 'string' && cmp(def.get(i) as string, d);
    }
    if (def.kind === 'priority') {
      if (!(low(v) in PRIORITY_RANK)) throw new QueryError(`Unknown priority "${v}".`);
      const r = PRIORITY_RANK[low(v)];
      return (i) => cmp(PRIORITY_RANK[String(def.get(i))] ?? -1, r);
    }
    throw new QueryError(`Operator ${op} can't be used with "${field}".`);
  };

  const readValue = (): string => {
    const t = next();
    if (!t || (t.t !== 'word' && t.t !== 'str')) throw new QueryError('Expected a value.');
    return t.v;
  };

  function parseCond(): Pred {
    const t = peek();
    if (!t) throw new QueryError('Unexpected end of query.');
    if (t.t === 'lp') {
      next();
      const e = parseOr();
      if (peek()?.t !== 'rp') throw new QueryError('Missing ")".');
      next();
      return e;
    }
    if (isKw(t, 'not')) {
      next();
      const e = parseCond();
      return (i) => !e(i);
    }
    const n1 = peek(1);
    const fieldLike = t.t === 'word' && n1 && (n1.t === 'op' || isKw(n1, 'in') || isKw(n1, 'is'));
    if (!fieldLike) {
      // free-text term
      if (t.t !== 'word' && t.t !== 'str') throw new QueryError(`Unexpected "${t.v}".`);
      next();
      const def = resolveField('text', ctx);
      return containsTest(def, t.v);
    }
    const field = next().v;
    const def = resolveField(field, ctx);
    const opTok = next();

    if (isKw(opTok, 'is')) {
      let negate = false;
      if (isKw(peek(), 'not')) {
        next();
        negate = true;
      }
      if (!isKw(peek(), 'empty')) throw new QueryError('Expected EMPTY after IS.');
      next();
      return (i) => isEmpty(def.get(i)) !== negate;
    }
    if (isKw(opTok, 'in')) {
      if (next()?.t !== 'lp') throw new QueryError('Expected "(" after IN.');
      const tests: Pred[] = [];
      for (;;) {
        tests.push(eqTest(def, readValue()));
        const sep = next();
        if (sep?.t === 'rp') break;
        if (sep?.t !== 'comma') throw new QueryError('Expected "," or ")".');
      }
      return (i) => tests.some((p) => p(i));
    }
    const op = opTok.v;
    const value = readValue();
    if (op === '=') return eqTest(def, value);
    if (op === '!=') {
      const p = eqTest(def, value);
      return (i) => !p(i);
    }
    if (op === '~') return containsTest(def, value);
    return compareTest(def, op, value, field);
  }

  function parseAnd(): Pred {
    let left = parseCond();
    while (peek() && (isKw(peek(), 'and') || (!isKw(peek(), 'or') && !isKw(peek(), 'order') && peek()!.t !== 'rp'))) {
      if (isKw(peek(), 'and')) next(); // implicit AND between terms ("foo bar")
      const right = parseCond();
      const l = left;
      left = (i) => l(i) && right(i);
    }
    return left;
  }

  function parseOr(): Pred {
    let left = parseAnd();
    while (isKw(peek(), 'or')) {
      next();
      const right = parseAnd();
      const l = left;
      left = (i) => l(i) || right(i);
    }
    return left;
  }

  let match: Pred = () => true;
  if (toks.length && !isKw(peek(), 'order')) match = parseOr();

  let compare: ((a: Issue, b: Issue) => number) | undefined;
  if (isKw(peek(), 'order')) {
    next();
    if (!isKw(peek(), 'by')) throw new QueryError('Expected BY after ORDER.');
    next();
    const f = next();
    if (!f || f.t !== 'word') throw new QueryError('Expected a field after ORDER BY.');
    let dir = 1;
    if (isKw(peek(), 'desc')) {
      next();
      dir = -1;
    } else if (isKw(peek(), 'asc')) next();
    const key = low(f.v);
    const value = (i: Issue): number | string | undefined => {
      const proj = ctx.projects.find((p) => p.id === i.projectId);
      switch (key) {
        case 'key':
          return `${proj?.key ?? ''}-${String(i.number).padStart(6, '0')}`;
        case 'priority':
          return PRIORITY_RANK[i.priority];
        case 'due':
          return i.dueDate;
        case 'created':
          return i.createdAt;
        case 'updated':
          return i.updatedAt;
        case 'status':
          return proj?.statuses.findIndex((s) => s.id === i.statusId);
        case 'title':
        case 'summary':
          return low(i.title);
        case 'estimate':
          return i.estimate;
        default:
          throw new QueryError(`Can't order by "${f.v}".`);
      }
    };
    value({} as Issue); // validate the field name eagerly
    compare = (a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === undefined && y === undefined) return 0;
      if (x === undefined) return 1; // missing values always last
      if (y === undefined) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    };
  }

  if (pos < toks.length) throw new QueryError(`Unexpected "${toks[pos].v}".`);
  return { ok: true, match, compare };
}

/** Heuristic: should the search box text be treated as a query instead of plain text? */
export function looksLikeQuery(s: string): boolean {
  // Operators, or UPPERCASE keywords only, so plain searches like "fix in prod" stay plain text.
  return /[=~<>!]|\b(AND|OR|NOT|ORDER BY)\b/.test(s);
}
