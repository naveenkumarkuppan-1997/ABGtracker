"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/domain/attachments.ts
var DEFAULT_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerIssue: 25,
  orgQuotaBytes: 1024 * 1024 * 1024
};
var BLOCKED_EXTENSIONS = ["exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "vbe", "js", "jse", "wsf", "jar", "dll", "reg", "lnk", "sh", "apk", "app", "dmg"];
var extensionOf = (name) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};
function cleanFileName(raw) {
  let n = raw.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\\/g, "/").split("/").pop().trim().replace(/^\.+/, "").replace(/\s+/g, " ");
  if (n.length > 120) {
    const ext = extensionOf(n);
    const keep = ext && ext.length <= 10 ? `.${ext}` : "";
    n = n.slice(0, 120 - keep.length) + keep;
  }
  return n || "file";
}
function fileProblem(name, size, limits = DEFAULT_LIMITS, blocked = BLOCKED_EXTENSIONS) {
  if (size <= 0) return "That file is empty.";
  if (size > limits.maxFileBytes) return `Files can be up to ${formatBytes(limits.maxFileBytes)}. This one is ${formatBytes(size)}.`;
  const ext = extensionOf(name);
  if (ext && blocked.includes(ext)) return `\u201C.${ext}\u201D files can't be attached, because they can run programs on someone's computer.`;
  return null;
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
var INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
var isInlineImage = (mime) => INLINE_IMAGE_TYPES.includes(mime);
function sniffImage(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 6 && b[0] === 71 && b[1] === 73 && b[2] === 70 && b[3] === 56 && (b[4] === 55 || b[4] === 57) && b[5] === 97) return "image/gif";
  if (b.length >= 12 && b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) return "image/webp";
  return null;
}
function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

// src/domain/columns.ts
var MAX_COLUMNS = 12;
var MAX_COLUMN_NAME = 40;
var slug = (s2) => s2.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "column";
function newStatusId(name, existing) {
  const base = slug(name);
  const taken = new Set(existing.map((s2) => s2.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}
function removeProblem(statuses, id) {
  if (statuses.length <= 2) return "A project needs at least two columns.";
  const rest = statuses.filter((s2) => s2.id !== id);
  if (!rest.some((s2) => s2.category === "done")) return "At least one column must count as Finished.";
  return null;
}
function columnsProblem(statuses) {
  if (statuses.length < 2) return "A project needs at least two columns.";
  if (statuses.length > MAX_COLUMNS) return `A project can have at most ${MAX_COLUMNS} columns.`;
  const names = /* @__PURE__ */ new Set();
  for (const s2 of statuses) {
    const n = s2.name.trim().toLowerCase();
    if (!n) return "Every column needs a name.";
    if (s2.name.trim().length > MAX_COLUMN_NAME) return `Column names must be under ${MAX_COLUMN_NAME} characters.`;
    if (names.has(n)) return `There is already a column called \u201C${s2.name.trim()}\u201D.`;
    names.add(n);
  }
  if (!statuses.some((s2) => s2.category === "done")) return "At least one column must count as Finished.";
  return null;
}

// src/domain/issueTypes.ts
var TYPE_ICONS = [
  "check",
  "bookmark",
  "bug",
  "zap",
  "star",
  "lightbulb",
  "rocket",
  "wrench",
  "megaphone",
  "users",
  "phone",
  "mail",
  "file",
  "package",
  "truck",
  "wallet",
  "cart",
  "calendar",
  "heart",
  "palette",
  "flag",
  "shield",
  "branch"
];
var MAX_TYPES = 15;
var MAX_TYPE_NAME = 30;
function typeProblem(types, draft, exceptId) {
  const n = draft.name.trim();
  if (!n) return "Give the type a name.";
  if (n.length > MAX_TYPE_NAME) return `Keep the name under ${MAX_TYPE_NAME} characters.`;
  if (types.some((t2) => t2.id !== exceptId && t2.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a type called \u201C${n}\u201D.`;
  if (!TYPE_ICONS.includes(draft.icon)) return "Choose an icon from the list.";
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) return "Choose a colour.";
  if (![0, 1, 2].includes(draft.level)) return "Choose what kind of item this is.";
  return null;
}
function typesProblem(types) {
  if (types.length === 0 || !types.some((t2) => t2.level === 1)) return "A project needs at least one work-item type.";
  if (types.length > MAX_TYPES) return `A project can have at most ${MAX_TYPES} types.`;
  if (new Set(types.map((t2) => t2.id)).size !== types.length) return "Type ids must be unique.";
  if (types.some((t2) => !/^[a-z0-9_-]{1,40}$/i.test(t2.id))) return "A type id may only contain letters, digits, dashes and underscores.";
  const seen = /* @__PURE__ */ new Set();
  for (const t2 of types) {
    const problem = typeProblem(types.filter((x) => x.id !== t2.id), t2, t2.id);
    if (problem) return problem;
    const key = t2.name.trim().toLowerCase();
    if (seen.has(key)) return `There is already a type called \u201C${t2.name}\u201D.`;
    seen.add(key);
  }
  return null;
}
function removeTypeProblem(types, id) {
  const t2 = types.find((x) => x.id === id);
  if (!t2) return "Type not found.";
  if (t2.level === 1 && types.filter((x) => x.level === 1).length <= 1) return "A project needs at least one work-item type.";
  return null;
}

// src/domain/forms.ts
var MAX_ANSWER_LENGTH = 5e3;
var MAX_SUBMISSIONS_PER_HOUR = 20;
var PUBLIC_MAX_FILES = 3;
var slugify = (s2) => s2.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PRIORITIES = ["critical", "high", "medium", "low"];
function validateForm(input, project) {
  if (!input.name.trim()) return "Give the form a name.";
  if (input.slug !== void 0 && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(input.slug)) return "The link name must be 2-40 lowercase letters, digits or dashes.";
  const type = project.issueTypes.find((t2) => t2.id === input.issueTypeId);
  if (!type || type.level === 2) return "Choose the issue type that requests become.";
  if (input.fields.length === 0) return "Add at least one question.";
  if (input.fields.length > 20) return "A form can have at most 20 questions.";
  const ids = /* @__PURE__ */ new Set();
  const targets = /* @__PURE__ */ new Set();
  if (input.fields.filter((f) => f.kind === "file").length > 1) return "A form can have only one file upload question.";
  for (const f of input.fields) {
    if (!f.label.trim()) return "Every question needs a label.";
    if (ids.has(f.id)) return "Question ids must be unique.";
    ids.add(f.id);
    if (f.kind === "select" && !(f.options ?? []).filter(Boolean).length) return `\u201C${f.label}\u201D needs at least one option.`;
    if (f.kind === "file") continue;
    if (f.target !== "description") {
      if (targets.has(f.target)) return `Two questions fill the same field (${f.target}).`;
      targets.add(f.target);
    }
    if (f.target === "title" && (f.kind === "long" || f.kind === "select")) return "The title question should be short text.";
    if (f.target === "priority" && f.kind !== "select") return "The priority question must be a dropdown (Critical, High, Medium, Low).";
    if (f.target === "priority" && (f.options ?? []).some((o) => !PRIORITIES.includes(o.trim().toLowerCase()))) {
      return "Priority options must be Critical, High, Medium or Low.";
    }
    if (f.target === "dueDate" && f.kind !== "date") return "The due-date question must be a date.";
    if (f.target.startsWith("cf:")) {
      const def = project.customFields.find((c) => c.id === f.target.slice(3));
      if (!def) return `\u201C${f.label}\u201D points to a custom field that no longer exists.`;
    }
  }
  if (!targets.has("title")) return "One question must be the issue title.";
  if (!input.fields.some((f) => f.target === "title" && f.required)) return "The title question must be required.";
  return null;
}
function validateSubmission(form, answers, submitter) {
  if (!submitter.name.trim()) return "Please tell us your name.";
  if (!EMAIL_RE.test(submitter.email.trim())) return "Please enter a valid email address.";
  for (const f of form.fields) {
    if (f.kind === "file") continue;
    const v = (answers[f.id] ?? "").trim();
    if (f.required && !v) return `\u201C${f.label}\u201D is required.`;
    if (!v) continue;
    if (v.length > MAX_ANSWER_LENGTH) return `\u201C${f.label}\u201D is too long.`;
    if (f.kind === "email" && !EMAIL_RE.test(v)) return `\u201C${f.label}\u201D must be a valid email.`;
    if (f.kind === "number" && !Number.isFinite(Number(v))) return `\u201C${f.label}\u201D must be a number.`;
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `\u201C${f.label}\u201D must be a date.`;
    if (f.kind === "select" && !(f.options ?? []).includes(v)) return `\u201C${f.label}\u201D: choose one of the options.`;
  }
  return null;
}
var toPriority = (v) => {
  const l = v.toLowerCase();
  return PRIORITIES.includes(l) ? l : void 0;
};
function buildIssue(form, project, answers, submitter) {
  let title = "";
  let priority = form.defaultPriority;
  let dueDate;
  const customFields = {};
  const descriptionLines = [];
  for (const f of form.fields) {
    if (f.kind === "file") continue;
    const v = (answers[f.id] ?? "").trim();
    if (!v) continue;
    if (f.target === "title") title = v.replace(/\s+/g, " ");
    else if (f.target === "priority") priority = toPriority(v) ?? priority;
    else if (f.target === "dueDate") dueDate = v;
    else if (f.target.startsWith("cf:")) {
      const def = project.customFields.find((c) => c.id === f.target.slice(3));
      if (def) customFields[def.id] = def.type === "number" ? Number(v) : def.type === "multiselect" ? v.split(",").map((x) => x.trim()) : def.type === "checkbox" ? /^(yes|true|1)$/i.test(v) : v;
    } else descriptionLines.push(f.kind === "long" ? `**${f.label}**
${v}` : `**${f.label}:** ${v}`);
  }
  descriptionLines.push(`
---
_Submitted via \u201C${form.name}\u201D by ${submitter.name.trim()} (${submitter.email.trim()})_`);
  return {
    projectId: form.projectId,
    typeId: form.issueTypeId,
    title: title.slice(0, 200),
    description: descriptionLines.join("\n\n"),
    priority,
    assigneeId: form.defaultAssigneeId,
    dueDate,
    customFields,
    labels: ["intake"]
  };
}

// src/domain/selectors.ts
var statusOf = (p, id) => p.statuses.find((s2) => s2.id === id);
var typeOf = (p, id) => p.issueTypes.find((t2) => t2.id === id);
function isDone(p, issue) {
  return statusOf(p, issue.statusId)?.category === "done";
}

// src/domain/automation.ts
var low = (s2) => (s2 ?? "").toLowerCase();
function conditionMatches(c, issue, project) {
  let values;
  switch (c.field) {
    case "type": {
      const t2 = project.issueTypes.find((x) => x.id === issue.typeId);
      values = t2 ? [t2.id, t2.name] : [issue.typeId];
      break;
    }
    case "status": {
      const s2 = project.statuses.find((x) => x.id === issue.statusId);
      values = s2 ? [s2.id, s2.name] : [issue.statusId];
      break;
    }
    case "priority":
      values = [issue.priority];
      break;
    case "label":
      values = issue.labels;
      break;
    case "assignee":
      values = issue.assigneeId ? [issue.assigneeId] : [];
      break;
  }
  switch (c.op) {
    case "is":
      return values.some((v) => low(v) === low(c.value));
    case "is_not":
      return !values.some((v) => low(v) === low(c.value));
    case "is_empty":
      return values.length === 0;
    case "is_not_empty":
      return values.length > 0;
  }
}
function triggerMatches(rule, ev) {
  if (rule.trigger.type !== ev.type) return false;
  switch (ev.type) {
    case "issue_created":
    case "due_date_passed":
      return true;
    case "status_changed":
      return !!ev.before && ev.before.statusId !== ev.issue.statusId && (!rule.trigger.statusId || rule.trigger.statusId === ev.issue.statusId);
    case "assignee_changed":
      return !!ev.before && ev.before.assigneeId !== ev.issue.assigneeId;
    case "priority_changed":
      return !!ev.before && ev.before.priority !== ev.issue.priority;
  }
}
function ruleMatches(rule, ev, project) {
  return rule.enabled && triggerMatches(rule, ev) && rule.conditions.every((c) => conditionMatches(c, ev.issue, project));
}
function planActions(rule, issue, project, members) {
  const plan = { patch: {}, comments: [], notify: [], errors: [] };
  const labels = [...issue.labels];
  const isMember = (id) => members.some((m) => m.id === id);
  for (const a of rule.actions) {
    switch (a.type) {
      case "set_assignee":
        if (a.value && isMember(a.value)) plan.patch.assigneeId = a.value;
        else plan.errors.push("Assignee is not in this organization.");
        break;
      case "set_priority":
        if (["critical", "high", "medium", "low"].includes(a.value ?? "")) plan.patch.priority = a.value;
        else plan.errors.push("Unknown priority.");
        break;
      case "move_to_status":
        if (project.statuses.some((s2) => s2.id === a.value)) plan.patch.statusId = a.value;
        else plan.errors.push("Target status no longer exists.");
        break;
      case "add_label":
        if (a.value?.trim() && !labels.includes(a.value.trim())) {
          labels.push(a.value.trim());
          plan.patch.labels = labels;
        }
        break;
      case "add_comment":
        if (a.value?.trim()) plan.comments.push(a.value.trim());
        break;
      case "notify": {
        const id = a.value === "assignee" ? issue.assigneeId : a.value === "reporter" ? issue.reporterId : a.value;
        if (id && isMember(id)) plan.notify.push(id);
        break;
      }
    }
  }
  return plan;
}
function validateRule(input, project) {
  if (!input.name.trim()) return "Give the rule a name.";
  if (input.actions.length === 0) return "A rule needs at least one action.";
  if (input.trigger.statusId && !project.statuses.some((s2) => s2.id === input.trigger.statusId)) return "The trigger status no longer exists.";
  for (const a of input.actions) {
    if (a.type !== "add_comment" && a.type !== "notify" && !a.value) return "Fill in every action.";
    if (a.type === "add_comment" && !a.value?.trim()) return "The comment action needs text.";
    if (a.type === "add_label" && !a.value?.trim()) return "The label action needs a label.";
  }
  if (input.trigger.type === "status_changed" && input.trigger.statusId && input.actions.some((a) => a.type === "move_to_status" && a.value === input.trigger.statusId)) {
    return "A rule cannot move issues into the status that triggers it.";
  }
  return null;
}

// src/domain/errors.ts
var DomainError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DomainError";
  }
};

// src/domain/approvals.ts
function approvalState(a) {
  const decisions = a.approverIds.map((id) => a.decisions[id]);
  if (decisions.some((d) => d?.decision === "rejected")) return "rejected";
  if (a.approverIds.length > 0 && decisions.every((d) => d?.decision === "approved")) return "approved";
  return "pending";
}
function checkApprovalGate(project, issue, toStatusId) {
  const toDone = project.statuses.find((s2) => s2.id === toStatusId)?.category === "done";
  if (toDone && issue.approval && approvalState(issue.approval) !== "approved") {
    return "This item needs approval from all approvers before it can be marked done.";
  }
  return null;
}
function applyDecision(a, userId, decision, comment, at) {
  if (!a.approverIds.includes(userId)) throw new DomainError("You are not an approver for this item.");
  return {
    approverIds: a.approverIds,
    decisions: { ...a.decisions, [userId]: { decision, comment: comment?.trim() || void 0, at } }
  };
}
function setApprovers(a, approverIds) {
  const unique = [...new Set(approverIds)];
  const decisions = {};
  for (const id of unique) if (a?.decisions[id]) decisions[id] = a.decisions[id];
  return { approverIds: unique, decisions };
}
function resetDecisions(a) {
  return { approverIds: a.approverIds, decisions: {} };
}

// src/domain/customFields.ts
var isEmptyValue = (v) => v === void 0 || v === null || v === "" || Array.isArray(v) && v.length === 0;
function fieldsFor(project, typeId) {
  return project.customFields.filter((f) => !f.typeIds || f.typeIds.length === 0 || f.typeIds.includes(typeId));
}
function validateValue(def, v) {
  if (isEmptyValue(v)) return null;
  switch (def.type) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : `${def.name} must be a number.`;
    case "checkbox":
      return typeof v === "boolean" ? null : `${def.name} must be true/false.`;
    case "select":
      return typeof v === "string" && (def.options ?? []).includes(v) ? null : `${def.name}: "${String(v)}" is not an option.`;
    case "multiselect":
      return Array.isArray(v) && v.every((x) => (def.options ?? []).includes(x)) ? null : `${def.name} has an invalid option.`;
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : `${def.name} must be a date.`;
    case "url":
      return typeof v === "string" && /^https?:\/\/\S+$/i.test(v) ? null : `${def.name} must be a http(s) link.`;
    default:
      return typeof v === "string" ? null : `${def.name} must be text.`;
  }
}
function validateCustomFields(project, typeId, values, opts) {
  const defs = fieldsFor(project, typeId);
  for (const def of defs) {
    const v = values[def.id];
    const err = validateValue(def, v ?? null);
    if (err) return err;
    if (opts.enforceRequired && def.required && isEmptyValue(v)) return `${def.name} is required.`;
  }
  return null;
}

// src/domain/dependencies.ts
function wouldCreateCycle(issues, issueId, blockedBy) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const seen = /* @__PURE__ */ new Set();
  const stack = [...blockedBy];
  while (stack.length) {
    const id = stack.pop();
    if (id === issueId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.blockedBy ?? []) stack.push(next);
  }
  return false;
}
function openBlockers(project, issues, issue) {
  return issue.blockedBy.map((id) => issues.find((i) => i.id === id)).filter((b) => !!b && !isDone(project, b));
}

// src/domain/sprints.ts
var counted = (project, i) => typeOf(project, i.typeId)?.level === 1;
function sprintStats(project, issues, sprintId) {
  const items = issues.filter((i) => i.sprintId === sprintId && counted(project, i));
  const done = items.filter((i) => isDone(project, i));
  const sum = (l) => l.reduce((s2, i) => s2 + (i.estimate ?? 0), 0);
  return { count: items.length, doneCount: done.length, points: sum(items), donePoints: sum(done) };
}
function validateSprintDates(start, end) {
  if (start && end && end < start) return "The end date must be on or after the start date.";
  return null;
}
function checkStart(sprint, siblings) {
  if (sprint.state !== "planned") return "Only a planned sprint can be started.";
  if (!sprint.startDate || !sprint.endDate) return "Set start and end dates before starting the sprint.";
  const dateErr = validateSprintDates(sprint.startDate, sprint.endDate);
  if (dateErr) return dateErr;
  const active = siblings.find((s2) => s2.state === "active" && s2.id !== sprint.id);
  if (active) return `\u201C${active.name}\u201D is still active. Complete it first.`;
  return null;
}

// src/domain/mentions.ts
var REACTIONS = ["\u{1F44D}", "\u2705", "\u{1F389}", "\u2764\uFE0F", "\u{1F440}", "\u{1F604}"];
var escapeRe = (s2) => s2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentionRegex(members) {
  if (!members.length) return null;
  const names = members.map((m) => escapeRe(m.name)).sort((a, b) => b.length - a.length);
  return new RegExp(`@(${names.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}
function extractMentions(body, members) {
  const re = mentionRegex(members);
  if (!re) return [];
  const found = /* @__PURE__ */ new Set();
  for (const m of body.matchAll(re)) {
    const user = members.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (user) found.add(user.id);
  }
  return [...found];
}

// src/domain/permissions.ts
var MATRIX = {
  owner: ["automation.manage", "sprint.manage", "project.create", "project.manage", "filter.share", "issue.create", "issue.edit", "issue.delete", "comment.add", "member.manage"],
  admin: ["automation.manage", "sprint.manage", "project.create", "project.manage", "filter.share", "issue.create", "issue.edit", "issue.delete", "comment.add", "member.manage"],
  member: ["sprint.manage", "project.create", "issue.create", "issue.edit", "comment.add"],
  guest: ["comment.add"]
};
function can(role, action) {
  return !!role && MATRIX[role].includes(action);
}

// src/domain/templates.ts
var t = (id, name, icon, color, level) => ({
  id,
  name,
  icon,
  color,
  level
});
var s = (id, name, category) => ({ id, name, category });
var TEMPLATES = {
  agile: {
    style: "agile",
    label: "Agile",
    tagline: "Sprints, backlog, epics and stories for software teams.",
    defaultTypeName: "Task",
    statuses: [
      s("backlog", "Backlog", "todo"),
      s("selected", "Selected", "todo"),
      s("in_progress", "In Progress", "in_progress"),
      s("in_review", "In Review", "in_progress"),
      s("done", "Done", "done")
    ],
    issueTypes: [
      t("epic", "Epic", "zap", "#7c5cd6", 0),
      t("story", "Story", "bookmark", "#2f9e6b", 1),
      t("task", "Task", "check", "#3b82f6", 1),
      t("bug", "Bug", "bug", "#dc4b4b", 1),
      t("subtask", "Sub-task", "branch", "#7b8794", 2)
    ]
  },
  flow: {
    style: "flow",
    label: "Flow (Kanban)",
    tagline: "Continuous flow with a simple board and clear limits.",
    defaultTypeName: "Task",
    statuses: [
      s("todo", "To Do", "todo"),
      s("doing", "Doing", "in_progress"),
      s("blocked", "Blocked", "in_progress"),
      s("done", "Done", "done")
    ],
    issueTypes: [
      t("task", "Task", "check", "#3b82f6", 1),
      t("bug", "Bug", "bug", "#dc4b4b", 1),
      t("subtask", "Sub-task", "branch", "#7b8794", 2)
    ]
  },
  business: {
    style: "business",
    label: "Business",
    tagline: "Tasks, milestones and approvals for ops, marketing and teams.",
    defaultTypeName: "Task",
    statuses: [
      s("not_started", "Not started", "todo"),
      s("in_progress", "In progress", "in_progress"),
      s("in_review", "Needs approval", "in_progress"),
      s("done", "Done", "done")
    ],
    issueTypes: [
      t("task", "Task", "check", "#3b82f6", 1),
      { ...t("milestone", "Milestone", "flag", "#f28c28", 0), kind: "milestone" },
      { ...t("approval", "Approval", "shield", "#0f8b8d", 1), kind: "approval" },
      t("subtask", "Sub-task", "branch", "#7b8794", 2)
    ]
  }
};
function defaultCustomFields(style) {
  if (style === "agile") {
    return [
      { id: "cf_env", name: "Environment", type: "select", options: ["Dev", "Staging", "Production"], typeIds: ["bug"] },
      { id: "cf_customer", name: "Customer", type: "text" }
    ];
  }
  if (style === "business") {
    return [
      { id: "cf_budget", name: "Budget", type: "number" },
      { id: "cf_channel", name: "Channel", type: "multiselect", options: ["Email", "Social", "Events", "PR"] }
    ];
  }
  return [];
}

// src/domain/workflow.ts
var REQUIRED_FIELD_LABEL = {
  assigneeId: "Assignee",
  estimate: "Estimate",
  dueDate: "Due date",
  description: "Description"
};
var isEmpty = (v) => v === void 0 || v === null || typeof v === "string" && v.trim() === "";
function allowedTargets(project, fromId) {
  const { workflow, statuses } = project;
  if (!workflow.restrict) return statuses;
  const allowed = /* @__PURE__ */ new Set([fromId, ...workflow.transitions[fromId] ?? []]);
  return statuses.filter((s2) => allowed.has(s2.id));
}
function checkTransition(project, issue, toStatusId, patch = {}) {
  if (toStatusId === issue.statusId) return null;
  const name = (id) => project.statuses.find((s2) => s2.id === id)?.name ?? id;
  if (!allowedTargets(project, issue.statusId).some((s2) => s2.id === toStatusId)) {
    const allowed = allowedTargets(project, issue.statusId).filter((s2) => s2.id !== issue.statusId).map((s2) => s2.name);
    return `"${name(issue.statusId)}" can't move directly to "${name(toStatusId)}". Allowed: ${allowed.join(", ") || "none"}.`;
  }
  return checkRequired(project, { ...issue, ...patch }, toStatusId);
}
function checkRequired(project, issue, statusId) {
  const rule = project.workflow.rules.find((r) => r.toStatusId === statusId);
  if (!rule) return null;
  const missing = rule.require.filter((f) => isEmpty(issue[f]));
  if (!missing.length) return null;
  const to = project.statuses.find((s2) => s2.id === statusId)?.name ?? statusId;
  return `Moving to "${to}" requires: ${missing.map((f) => REQUIRED_FIELD_LABEL[f]).join(", ")}.`;
}
function sanitizeWorkflow(workflow, statuses) {
  const ids = new Set(statuses.map((s2) => s2.id));
  const transitions = {};
  for (const [from, targets] of Object.entries(workflow.transitions)) {
    if (ids.has(from)) transitions[from] = targets.filter((t2) => ids.has(t2) && t2 !== from);
  }
  return {
    restrict: workflow.restrict,
    transitions,
    rules: workflow.rules.filter((r) => ids.has(r.toStatusId) && r.require.length > 0)
  };
}
function defaultWorkflow(style, statuses) {
  const order = statuses.map((s2) => s2.id);
  if (style === "agile") {
    const transitions = {};
    order.forEach((id, i) => {
      const t2 = [];
      if (order[i + 1]) t2.push(order[i + 1]);
      if (order[i - 1]) t2.push(order[i - 1]);
      transitions[id] = t2;
    });
    return {
      restrict: true,
      transitions,
      rules: [
        { toStatusId: "in_progress", require: ["assigneeId"] },
        { toStatusId: "done", require: ["assigneeId"] }
      ]
    };
  }
  if (style === "business") {
    return { restrict: false, transitions: {}, rules: [{ toStatusId: "in_review", require: ["assigneeId", "dueDate"] }] };
  }
  return { restrict: false, transitions: {}, rules: [] };
}

// src/domain/timeline.ts
var DAY = 864e5;
var toDay = (s2) => Math.floor(Date.parse(s2 + "T00:00:00Z") / DAY);

// src/domain/reports.ts
var level1 = (p, i) => typeOf(p, i.typeId)?.level === 1;
var dayOf = (iso) => toDay(iso.slice(0, 10));
var todayOf = (now2) => toDay(`${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(now2.getDate()).padStart(2, "0")}`);
function weekBuckets(now2, weeks) {
  const today = todayOf(now2);
  const dow = (today + 4) % 7;
  const monday = today - (dow + 6) % 7;
  return Array.from({ length: weeks }, (_, i) => {
    const start = monday - (weeks - 1 - i) * 7;
    const d = new Date(start * 864e5);
    return { start, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
  });
}
var bucketIndex = (buckets, day) => {
  for (let i = buckets.length - 1; i >= 0; i--) if (day >= buckets[i].start) return day < buckets[i].start + 7 ? i : -1;
  return -1;
};
function weeklyResolved(project, issues, now2, weeks, measure = "count") {
  const buckets = weekBuckets(now2, weeks);
  const out = new Array(weeks).fill(0);
  for (const i of issues) {
    if (i.projectId !== project.id || !level1(project, i) || !i.resolvedAt) continue;
    const idx = bucketIndex(buckets, dayOf(i.resolvedAt));
    if (idx >= 0) out[idx] += measure === "points" ? i.estimate ?? 0 : 1;
  }
  return out;
}
function weeklyCreated(project, issues, now2, weeks) {
  const buckets = weekBuckets(now2, weeks);
  const out = new Array(weeks).fill(0);
  for (const i of issues) {
    if (i.projectId !== project.id || !level1(project, i)) continue;
    const idx = bucketIndex(buckets, dayOf(i.createdAt));
    if (idx >= 0) out[idx] += 1;
  }
  return out;
}

// src/domain/dashboard.ts
var WIDGETS = [
  { id: "kpis", title: "At a glance", hint: "Open, overdue and blocked work, finished this week, and your own load.", size: "full" },
  { id: "briefing", title: "Your day, in brief (AI)", hint: "A short read on your day and a suggested order to tackle it. Appears only when an AI assistant is connected.", size: "full" },
  { id: "mine", title: "My open work", hint: "Everything assigned to you that is not finished, soonest due first.", size: "half" },
  { id: "dueSoon", title: "Due soon & overdue (mine)", hint: "Your work due in the next 7 days, plus anything that slipped.", size: "half" },
  { id: "approvals", title: "Waiting for my approval", hint: "Items that need your sign-off.", size: "half" },
  { id: "watching", title: "Following", hint: "Unfinished items you watch.", size: "half" },
  { id: "projects", title: "Projects", hint: "Every project with its progress.", size: "full" },
  { id: "health", title: "Project health", hint: "On track / needs attention / at risk, with the reasons. Takes a moment to calculate.", size: "full" },
  { id: "workload", title: "Team workload", hint: "Open work per person, with what is overdue.", size: "half" },
  { id: "trend", title: "Created vs finished", hint: "The last 6 weeks.", size: "half" },
  { id: "status", title: "Work by stage", hint: "How much is not started, in progress, and done.", size: "half" },
  { id: "priority", title: "Open work by priority", hint: "Where the urgent items are.", size: "half" },
  { id: "upcoming", title: "Coming up (everyone)", hint: "Anything due in the next 14 days.", size: "half" },
  { id: "activity", title: "Recent activity", hint: "The latest changes across the organization.", size: "full" }
];
var KNOWN = new Map(WIDGETS.map((w) => [w.id, w]));
var SIZES = ["half", "full"];
var MAX_WIDGETS = 30;
function defaultLayout(role) {
  const guest = ["mine", "dueSoon", "approvals", "activity"];
  const hiddenByDefault = ["health", "watching", "priority"];
  return {
    widgets: WIDGETS.map((w) => ({
      id: w.id,
      size: w.size,
      visible: role === "guest" ? guest.includes(w.id) : !hiddenByDefault.includes(w.id)
    }))
  };
}
function normalizeLayout(raw, role) {
  const base = defaultLayout(role);
  const list = Array.isArray(raw?.widgets) ? raw.widgets : null;
  if (!list) return base;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const w of list.slice(0, MAX_WIDGETS)) {
    const def = w && KNOWN.get(w.id);
    if (!def || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, visible: w.visible !== false, size: SIZES.includes(w.size) ? w.size : def.size });
  }
  for (const d of base.widgets) if (!seen.has(d.id)) out.push(d);
  return { widgets: out };
}
function validateLayout(raw) {
  const list = raw?.widgets;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_WIDGETS) throw new Error("That dashboard layout is not valid.");
  const seen = /* @__PURE__ */ new Set();
  for (const w of list) {
    if (!w || typeof w !== "object" || !KNOWN.has(w.id) || typeof w.visible !== "boolean" || !SIZES.includes(w.size) || seen.has(w.id)) throw new Error("That dashboard layout is not valid.");
    seen.add(w.id);
  }
  return normalizeLayout({ widgets: list.map((w) => ({ id: w.id, visible: w.visible, size: w.size })) });
}
var localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
var addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
function computeDashboard(data, userId, now2 = /* @__PURE__ */ new Date(), projectId) {
  const today = localDay(now2);
  const projects = projectId ? data.projects.filter((p) => p.id === projectId) : data.projects;
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const issues = data.issues.filter((i) => projectOf.has(i.projectId));
  const perProject = new Map(projects.map((p) => [p.id, issues.filter((i) => i.projectId === p.id)]));
  const row = (issue) => ({ issue, project: projectOf.get(issue.projectId) });
  const late = (r) => !!r.issue.dueDate && r.issue.dueDate < today && !isDone(r.project, r.issue);
  const byDue = (a, b) => (a.issue.dueDate ?? "9999").localeCompare(b.issue.dueDate ?? "9999") || a.issue.number - b.issue.number;
  const work = issues.filter((i) => typeOf(projectOf.get(i.projectId), i.typeId)?.level === 1).map(row);
  const open = work.filter((r) => !isDone(r.project, r.issue));
  const weekAgo = new Date(now2.getTime() - 7 * 864e5).toISOString();
  const mine = issues.filter((i) => i.assigneeId === userId).map(row).filter((r) => !isDone(r.project, r.issue)).sort(byDue);
  const horizon = addDays(today, 7);
  const upto = addDays(today, 14);
  const priority = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of open) priority[r.issue.priority]++;
  const stage = { todo: 0, in_progress: 0, done: 0 };
  for (const r of work) stage[r.project.statuses.find((s2) => s2.id === r.issue.statusId)?.category ?? "todo"]++;
  const people = /* @__PURE__ */ new Map();
  for (const r of open) {
    const key = r.issue.assigneeId ?? "";
    const cur = people.get(key) ?? { userId: r.issue.assigneeId, name: data.members.find((m) => m.id === r.issue.assigneeId)?.name ?? "Unassigned", open: 0, overdue: 0 };
    cur.open++;
    if (late(r)) cur.overdue++;
    people.set(key, cur);
  }
  const labels = weekBuckets(now2, 6).map((b) => b.label);
  const created = new Array(6).fill(0);
  const finished = new Array(6).fill(0);
  for (const p of projects) {
    weeklyCreated(p, data.issues, now2, 6).forEach((n, i) => created[i] += n);
    weeklyResolved(p, data.issues, now2, 6).forEach((n, i) => finished[i] += n);
  }
  const tiles = {
    open: [...open].sort(byDue),
    overdue: open.filter(late).sort(byDue),
    blocked: open.filter((r) => openBlockers(r.project, perProject.get(r.project.id), r.issue).length > 0).sort(byDue),
    doneThisWeek: work.filter((r) => r.issue.resolvedAt && r.issue.resolvedAt >= weekAgo && isDone(r.project, r.issue)).sort((a, b) => (b.issue.resolvedAt ?? "").localeCompare(a.issue.resolvedAt ?? "")),
    myOpen: mine,
    myOverdue: mine.filter(late)
  };
  return {
    today,
    tiles,
    kpis: {
      open: tiles.open.length,
      overdue: tiles.overdue.length,
      blocked: tiles.blocked.length,
      doneThisWeek: tiles.doneThisWeek.length,
      myOpen: tiles.myOpen.length,
      myOverdue: tiles.myOverdue.length
    },
    mine,
    dueSoon: mine.filter((r) => r.issue.dueDate && r.issue.dueDate <= horizon),
    approvals: issues.filter((i) => i.approval?.approverIds.includes(userId) && !i.approval.decisions[userId]).map(row),
    watching: issues.filter((i) => (i.watcherIds ?? []).includes(userId)).map(row).filter((r) => !isDone(r.project, r.issue)).sort(byDue).slice(0, 10),
    upcoming: open.filter((r) => r.issue.dueDate && r.issue.dueDate >= today && r.issue.dueDate <= upto).sort(byDue).slice(0, 12),
    priority,
    stage,
    workload: [...people.values()].sort((a, b) => b.open - a.open).slice(0, 8),
    trend: { labels, created, finished },
    activity: data.activity.filter((a) => projectOf.has(a.projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
  };
}

// src/domain/timeZone.ts
var isValidTimeZone = (tz) => {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
var parts = (at, tz) => {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const out = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(at)) out[p.type] = p.value;
  return out;
};
function localDate(at, tz) {
  const p = parts(at, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
function localHour(at, tz) {
  return Number(parts(at, tz).hour) % 24;
}
var nextDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

// src/domain/notifyPrefs.ts
var DEFAULT_NOTIFY_PREFS = { email: "instant", scope: "important" };
var IMPORTANT_KINDS = ["mention", "assigned", "approval", "intake", "due"];
var MAX_MUTED_PROJECTS = 200;
var NOTIFY_VERB = {
  mention: "mentioned you in",
  assigned: "assigned you",
  comment: "commented on",
  status: "changed the status of",
  approval: "updated the approval on",
  automation: "ran an automation on",
  intake: "sent a request:",
  due: "about"
  // "Reminder about PLT-3 Fix login" + the detail "Due tomorrow (2026-10-10)"
};
var isLead = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;
var cleanIds = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, MAX_MUTED_PROJECTS) : [];
var EMAIL_CHOICES = [
  { value: "instant", label: "As it happens", hint: "One email within a few minutes. Several updates close together are grouped." },
  { value: "daily", label: "Once a day", hint: "A single morning summary of everything new." },
  { value: "off", label: "Never", hint: "Only the Inbox in the app." }
];
var SCOPE_CHOICES = [
  { value: "important", label: "Only what needs me", hint: "Mentions, assignments, approvals and new requests." },
  { value: "all", label: "Everything in my Inbox", hint: "Also comments, status changes and automations on my work." }
];
function resolvePrefs(user) {
  const p = user?.notify;
  return {
    email: p && EMAIL_CHOICES.some((c) => c.value === p.email) ? p.email : DEFAULT_NOTIFY_PREFS.email,
    scope: p && SCOPE_CHOICES.some((c) => c.value === p.scope) ? p.scope : DEFAULT_NOTIFY_PREFS.scope,
    mutedProjects: cleanIds(p?.mutedProjects),
    ...isValidTimeZone(p?.timeZone) ? { timeZone: p.timeZone } : {},
    ...isLead(p?.dueLeadDays) ? { dueLeadDays: p.dueLeadDays } : {}
  };
}
function validatePrefs(input) {
  const p = input ?? {};
  const email = EMAIL_CHOICES.find((c) => c.value === p.email)?.value;
  const scope = SCOPE_CHOICES.find((c) => c.value === p.scope)?.value;
  if (!email || !scope) throw new Error("Choose one of the offered options.");
  if (p.mutedProjects !== void 0 && (!Array.isArray(p.mutedProjects) || p.mutedProjects.length > MAX_MUTED_PROJECTS)) throw new Error("Choose one of the offered options.");
  if (p.timeZone !== void 0 && p.timeZone !== null && !isValidTimeZone(p.timeZone)) throw new Error("Choose a time zone from the list.");
  if (p.dueLeadDays !== void 0 && p.dueLeadDays !== null && !isLead(p.dueLeadDays)) throw new Error("Choose 1 to 7 days.");
  return { email, scope, mutedProjects: cleanIds(p.mutedProjects), ...isValidTimeZone(p.timeZone) ? { timeZone: p.timeZone } : {}, ...isLead(p.dueLeadDays) ? { dueLeadDays: p.dueLeadDays } : {} };
}
function wantsEmail(prefs, kind, projectId) {
  if (prefs.email === "off") return false;
  if (projectId && prefs.mutedProjects?.includes(projectId)) return false;
  return prefs.scope === "all" || IMPORTANT_KINDS.includes(kind);
}

// src/data/seed.ts
var daysFromNow = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
var ago = (n) => new Date(Date.now() - n * 36e5).toISOString();
function buildSeed() {
  const users = [
    { id: "u_alex", name: "Alex Rivera", email: "alex@acme.dev", color: "#0f766e" },
    { id: "u_priya", name: "Priya Nair", email: "priya@acme.dev", color: "#7c5cd6" },
    { id: "u_sam", name: "Sam Chen", email: "sam@acme.dev", color: "#2f9e6b" },
    { id: "u_jordan", name: "Jordan Lee", email: "jordan@northwind.io", color: "#e8833a" },
    { id: "u_maya", name: "Maya Patel", email: "maya@northwind.io", color: "#dc4b4b" }
  ];
  const organizations = [
    { id: "org_acme", name: "Acme Software", slug: "acme", plan: "business", createdAt: ago(5e3) },
    { id: "org_nw", name: "Northwind Ops", slug: "northwind", plan: "team", createdAt: ago(3e3) }
  ];
  const memberships = [
    { id: "m1", orgId: "org_acme", userId: "u_alex", role: "owner" },
    { id: "m2", orgId: "org_acme", userId: "u_priya", role: "admin" },
    { id: "m3", orgId: "org_acme", userId: "u_sam", role: "member" },
    { id: "m4", orgId: "org_nw", userId: "u_alex", role: "member" },
    { id: "m5", orgId: "org_nw", userId: "u_jordan", role: "owner" },
    { id: "m6", orgId: "org_nw", userId: "u_maya", role: "guest" }
  ];
  const mkProject = (id, orgId, key, name, description, color, workStyle, leadId) => ({
    id,
    orgId,
    key,
    name,
    description,
    color,
    workStyle,
    statuses: TEMPLATES[workStyle].statuses,
    issueTypes: TEMPLATES[workStyle].issueTypes,
    workflow: defaultWorkflow(workStyle, TEMPLATES[workStyle].statuses),
    customFields: defaultCustomFields(workStyle),
    leadId,
    nextNumber: 1,
    createdAt: ago(2e3)
  });
  const projects = [
    mkProject("p_plt", "org_acme", "PLT", "Platform", "Core services and APIs.", "#0f766e", "agile", "u_priya"),
    mkProject("p_mob", "org_acme", "MOB", "Mobile App", "iOS and Android release train.", "#3b82f6", "flow", "u_sam"),
    mkProject("p_lch", "org_nw", "LCH", "Q4 Launch Campaign", "Cross-team launch plan.", "#f28c28", "business", "u_jordan")
  ];
  const sprints = [
    {
      id: "sp_7",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Sprint 7",
      goal: "Stabilise CI and logging.",
      startDate: daysFromNow(-28),
      endDate: daysFromNow(-15),
      state: "completed",
      committedPoints: 14,
      completedPoints: 11,
      startedAt: ago(28 * 24),
      completedAt: ago(15 * 24),
      createdAt: ago(32 * 24)
    },
    {
      id: "sp_8",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Sprint 8",
      goal: "Ship rate limiting and OAuth for API v2.",
      startDate: daysFromNow(-7),
      endDate: daysFromNow(7),
      state: "active",
      committedPoints: 22,
      startedAt: ago(7 * 24),
      createdAt: ago(20 * 24)
    },
    {
      id: "sp_9",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Sprint 9",
      goal: "Webhooks and observability foundations.",
      startDate: daysFromNow(8),
      endDate: daysFromNow(21),
      state: "planned",
      createdAt: ago(5 * 24)
    }
  ];
  const issues = [];
  const comments = [];
  const activity = [];
  let rankCounter = 1e3;
  const add = (projectId, type, title, status, o = {}) => {
    const p = projects.find((x) => x.id === projectId);
    const number = p.nextNumber++;
    const id = `i_${p.key.toLowerCase()}_${number}`;
    const status_ = p.statuses.find((x) => x.id === status);
    const resolvedAt = o.resolvedAgo !== void 0 ? ago(o.resolvedAgo * 24) : void 0;
    const created = o.resolvedAgo !== void 0 ? ago((o.resolvedAgo + (o.leadDays ?? 3)) * 24) : ago(500 - issues.length * 7);
    issues.push({
      id,
      orgId: p.orgId,
      projectId,
      key: `${p.key}-${number}`,
      number,
      typeId: type,
      title,
      description: o.desc ?? "",
      statusId: status,
      priority: o.priority ?? "medium",
      assigneeId: o.assignee,
      reporterId: o.reporter ?? p.leadId,
      parentId: o.parent,
      labels: o.labels ?? [],
      estimate: o.est,
      startDate: o.start !== void 0 ? daysFromNow(o.start) : void 0,
      dueDate: o.due !== void 0 ? daysFromNow(o.due) : void 0,
      customFields: o.cf ?? {},
      sprintId: o.sprint,
      blockedBy: o.blockedBy ?? [],
      approval: o.approval,
      rank: rankCounter += 1e3,
      createdAt: created,
      updatedAt: status_.category === "done" ? created : o.resolvedAgo !== void 0 ? created : ago(3 + issues.length * 37 % 90),
      resolvedAt: status_.category === "done" ? resolvedAt ?? created : void 0
    });
    activity.push({
      id: `a_${id}`,
      orgId: p.orgId,
      projectId,
      issueId: id,
      actorId: o.reporter ?? p.leadId,
      kind: "created",
      createdAt: created
    });
    return id;
  };
  const e1 = add("p_plt", "epic", "Public API v2", "in_progress", { assignee: "u_priya", priority: "high", start: -20, due: 30 });
  const e2 = add("p_plt", "epic", "Observability & alerting", "backlog", { assignee: "u_alex", start: 20, due: 60 });
  const s1 = add("p_plt", "story", "Rate limiting per API key", "in_progress", {
    assignee: "u_sam",
    parent: e1,
    est: 5,
    priority: "high",
    start: -6,
    due: 6,
    labels: ["api", "security"],
    sprint: "sp_8",
    desc: "Introduce per-key rate limits with sensible defaults and a 429 response with Retry-After."
  });
  add("p_plt", "subtask", "Token bucket implementation", "done", { assignee: "u_sam", parent: s1, est: 2, sprint: "sp_8", start: -6, due: -2 });
  add("p_plt", "subtask", "Expose limits in dashboard", "selected", { assignee: "u_priya", parent: s1, est: 2, sprint: "sp_8", start: -1, due: 5 });
  add("p_plt", "story", "OAuth2 client credentials flow", "in_review", { assignee: "u_priya", parent: e1, est: 8, labels: ["api"], sprint: "sp_8", start: -5, due: 4 });
  const pagination = add("p_plt", "story", "Cursor-based pagination", "selected", {
    assignee: "u_sam",
    parent: e1,
    est: 3,
    start: 3,
    due: 12,
    sprint: "sp_8",
    blockedBy: [s1]
  });
  const webhooks = add("p_plt", "story", "Webhook delivery retries", "backlog", { parent: e1, est: 5, start: 13, due: 22, sprint: "sp_9" });
  const bug1 = add("p_plt", "bug", "Duplicate events on retry", "in_progress", {
    assignee: "u_alex",
    priority: "critical",
    start: -3,
    due: 1,
    labels: ["prod"],
    cf: { cf_env: "Production", cf_customer: "Globex" },
    sprint: "sp_8",
    est: 3,
    desc: "Retried webhooks are delivered twice when the first attempt times out.\n\n**Steps**\n- Configure a slow endpoint\n- Trigger an event\n\nSee also `delivery_attempts` table."
  });
  issues.find((i) => i.id === webhooks).blockedBy = [bug1];
  add("p_plt", "bug", "Timezone off by one in reports", "backlog", { assignee: "u_sam", priority: "low", est: 2 });
  add("p_plt", "task", "Upgrade Node runtime to LTS", "done", { assignee: "u_alex", est: 2, sprint: "sp_8", start: -7, due: -5 });
  const logging = add("p_plt", "story", "Structured logging", "backlog", { parent: e2, est: 3, start: 20, due: 30 });
  add("p_plt", "story", "SLO dashboards", "backlog", { parent: e2, est: 5, assignee: "u_alex", start: 31, due: 45, sprint: "sp_9", blockedBy: [logging] });
  add("p_plt", "task", "Document error codes", "selected", { assignee: "u_priya", est: 1, priority: "low", due: 9, sprint: "sp_8" });
  add("p_plt", "task", "Migrate CI to GitHub Actions", "done", { assignee: "u_alex", est: 5, sprint: "sp_7" });
  add("p_plt", "task", "Add request IDs to logs", "done", { assignee: "u_sam", est: 3, sprint: "sp_7" });
  add("p_plt", "task", "Fix flaky auth tests", "done", { assignee: "u_priya", est: 3, sprint: "sp_7" });
  add("p_plt", "story", "Audit log export", "backlog", { est: 8, priority: "low" });
  void pagination;
  add("p_mob", "task", "Fix crash on cold start (Android 13)", "doing", { assignee: "u_sam", priority: "critical", due: 2 });
  add("p_mob", "task", "Dark mode for settings screen", "todo", { assignee: "u_priya", priority: "low" });
  add("p_mob", "bug", "Push notification badge not clearing", "blocked", { assignee: "u_alex", priority: "high", labels: ["ios"] });
  add("p_mob", "task", "Update app store screenshots", "todo", { due: 10 });
  add("p_mob", "task", "Migrate to new analytics SDK", "done", { assignee: "u_sam" });
  add("p_mob", "task", "Biometric login", "doing", { assignee: "u_priya", priority: "high" });
  const m1 = add("p_lch", "milestone", "Launch day", "not_started", { assignee: "u_jordan", priority: "high", due: 45 });
  const m2 = add("p_lch", "milestone", "Messaging locked", "in_progress", { assignee: "u_jordan", priority: "high", due: 14 });
  const t1 = add("p_lch", "task", "Finalize messaging & positioning", "in_progress", { assignee: "u_jordan", priority: "high", start: -10, due: 7, parent: m2 });
  add("p_lch", "subtask", "Competitor review", "done", { assignee: "u_alex", parent: t1 });
  add("p_lch", "subtask", "Draft one-pager", "in_progress", { assignee: "u_jordan", parent: t1 });
  const legal = add("p_lch", "approval", "Legal sign-off on claims", "in_review", {
    assignee: "u_maya",
    priority: "high",
    start: 2,
    due: 14,
    labels: ["legal"],
    parent: m2,
    approval: { approverIds: ["u_maya", "u_jordan"], decisions: { u_jordan: { decision: "approved", comment: "Claims match the product sheet.", at: ago(10) } } }
  });
  add("p_lch", "task", "Book launch webinar platform", "not_started", {
    assignee: "u_alex",
    start: 8,
    due: 20,
    cf: { cf_budget: 4500, cf_channel: ["Events", "Email"] },
    parent: m1,
    blockedBy: [legal]
  });
  add("p_lch", "task", "Press kit", "not_started", { assignee: "u_jordan", parent: m1, start: 22, due: 30, blockedBy: [t1] });
  add("p_lch", "approval", "Budget approval", "done", {
    assignee: "u_maya",
    priority: "medium",
    start: -14,
    due: -7,
    approval: { approverIds: ["u_maya", "u_jordan"], decisions: { u_maya: { decision: "approved", at: ago(200) }, u_jordan: { decision: "approved", at: ago(190) } } }
  });
  const history = (projectId, perWeek, titles, points, type, assignees) => {
    let n = 0;
    perWeek.forEach((count, w) => {
      for (let k = 0; k < count; k++, n++) {
        add(projectId, type, `${titles[n % titles.length]} (#${n + 1})`, "done", {
          assignee: assignees[n % assignees.length],
          est: points[n % points.length],
          resolvedAgo: (w + 1) * 7 - 1 - k * 2 % 6,
          leadDays: 2 + n % 5
        });
      }
    });
  };
  history("p_plt", [3, 4, 2, 5, 3, 4, 3, 2, 4, 3], ["Refactor module", "Add API tests", "Tune database query", "Update dependency", "Improve error message", "Fix lint warnings"], [1, 2, 3, 5, 2], "task", ["u_alex", "u_priya", "u_sam"]);
  history("p_mob", [2, 3, 2, 3, 2, 3, 2, 2], ["Polish screen", "Fix layout bug", "Update copy", "Add analytics event"], [], "task", ["u_sam", "u_priya", "u_alex"]);
  history("p_lch", [1, 2, 1, 2, 1, 1], ["Review asset", "Confirm vendor", "Schedule post"], [], "task", ["u_jordan", "u_alex"]);
  comments.push(
    { id: "c1", orgId: "org_acme", issueId: s1, authorId: "u_priya", body: "Let's default to **600 req/min** and make it configurable per plan. @Sam Chen can you confirm?", mentions: ["u_sam"], createdAt: ago(30) },
    { id: "c2", orgId: "org_acme", issueId: s1, authorId: "u_sam", body: "Agreed. Token bucket is merged, working on the dashboard exposure next.", mentions: [], createdAt: ago(6) },
    { id: "c3", orgId: "org_acme", issueId: bug1, authorId: "u_priya", body: "@Alex Rivera this is hitting Globex in production, please prioritise.", mentions: ["u_alex"], createdAt: ago(3) }
  );
  const notifications = [
    { id: "n1", orgId: "org_acme", userId: "u_alex", actorId: "u_priya", issueId: bug1, projectId: "p_plt", kind: "mention", detail: "this is hitting Globex in production, please prioritise.", read: false, createdAt: ago(3) },
    { id: "n2", orgId: "org_acme", userId: "u_alex", actorId: "u_priya", issueId: "i_plt_13", projectId: "p_plt", kind: "assigned", read: false, createdAt: ago(20) },
    { id: "n3", orgId: "org_nw", userId: "u_maya", actorId: "u_jordan", issueId: legal, projectId: "p_lch", kind: "approval", detail: "Your approval is requested", read: false, createdAt: ago(12) }
  ];
  const filters = [
    { id: "f1", orgId: "org_acme", ownerId: "u_priya", name: "Critical bugs", query: "type = Bug AND priority >= high AND statusCategory != done", shared: true, createdAt: ago(100) },
    { id: "f2", orgId: "org_acme", ownerId: "u_alex", name: "My overdue work", query: "assignee = me AND due < today AND statusCategory != done ORDER BY due", shared: false, createdAt: ago(90) },
    { id: "f3", orgId: "org_nw", ownerId: "u_jordan", name: "Needs sign-off", query: "type = Approval AND approval = pending", shared: true, createdAt: ago(60) },
    { id: "f4", orgId: "org_acme", ownerId: "u_alex", name: "In the active sprint", query: "sprint = active AND statusCategory != done ORDER BY priority DESC", shared: true, createdAt: ago(50) }
  ];
  const rules = [
    {
      id: "r1",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Triage new bugs",
      enabled: true,
      trigger: { type: "issue_created" },
      conditions: [{ field: "type", op: "is", value: "bug" }, { field: "assignee", op: "is_empty" }],
      actions: [{ type: "set_assignee", value: "u_alex" }, { type: "add_label", value: "needs-triage" }],
      createdBy: "u_priya",
      createdAt: ago(300),
      runCount: 0
    },
    {
      id: "r2",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Announce ready for review",
      enabled: true,
      trigger: { type: "status_changed", statusId: "in_review" },
      conditions: [],
      actions: [{ type: "add_comment", value: "Ready for review. Please leave feedback here." }, { type: "notify", value: "reporter" }],
      createdBy: "u_priya",
      createdAt: ago(290),
      runCount: 0
    },
    {
      id: "r3",
      orgId: "org_acme",
      projectId: "p_plt",
      name: "Escalate overdue work",
      enabled: true,
      trigger: { type: "due_date_passed" },
      conditions: [{ field: "priority", op: "is_not", value: "critical" }],
      actions: [{ type: "set_priority", value: "high" }, { type: "add_label", value: "overdue" }],
      createdBy: "u_priya",
      createdAt: ago(280),
      runCount: 0
    },
    {
      id: "r4",
      orgId: "org_nw",
      projectId: "p_lch",
      name: "Nudge owner when work starts",
      enabled: true,
      trigger: { type: "status_changed", statusId: "in_progress" },
      conditions: [{ field: "assignee", op: "is_empty" }],
      actions: [{ type: "set_assignee", value: "u_jordan" }, { type: "add_comment", value: "Assigned to the campaign owner because nobody was assigned." }],
      createdBy: "u_jordan",
      createdAt: ago(200),
      runCount: 0
    }
  ];
  const runs = [];
  const forms = [
    {
      id: "form_bug",
      orgId: "org_acme",
      projectId: "p_plt",
      slug: "report-a-bug",
      name: "Report a bug",
      description: "Found something broken? Tell us what happened and we will look into it.",
      enabled: true,
      issueTypeId: "bug",
      defaultPriority: "medium",
      createdBy: "u_priya",
      createdAt: ago(240),
      submissionCount: 0,
      fields: [
        { id: "q_title", label: "What went wrong?", kind: "short", required: true, target: "title" },
        { id: "q_steps", label: "Steps to reproduce", kind: "long", required: true, target: "description" },
        { id: "q_env", label: "Where did it happen?", kind: "select", required: false, options: ["Dev", "Staging", "Production"], target: "cf:cf_env" },
        { id: "q_pri", label: "How urgent is it?", kind: "select", required: false, options: ["Critical", "High", "Medium", "Low"], target: "priority" }
      ]
    },
    {
      id: "form_creative",
      orgId: "org_nw",
      projectId: "p_lch",
      slug: "creative-request",
      name: "Request creative work",
      description: "Need a banner, one-pager or social post for the launch? Ask here.",
      enabled: true,
      issueTypeId: "task",
      defaultPriority: "medium",
      defaultAssigneeId: "u_jordan",
      createdBy: "u_jordan",
      createdAt: ago(100),
      submissionCount: 0,
      fields: [
        { id: "q_what", label: "What do you need?", kind: "short", required: true, target: "title" },
        { id: "q_brief", label: "Brief", kind: "long", required: false, target: "description" },
        { id: "q_due", label: "Needed by", kind: "date", required: false, target: "dueDate" },
        { id: "q_budget", label: "Budget (USD)", kind: "number", required: false, target: "cf:cf_budget" }
      ]
    }
  ];
  return {
    organizations,
    users,
    memberships,
    projects,
    sprints,
    issues,
    comments,
    activity,
    notifications,
    filters,
    forms,
    attachments: [],
    rules,
    runs,
    sessionUserId: "u_alex"
  };
}

// src/data/localRepository.ts
var STORAGE_KEY = "abg2:db:v5";
var MAX_CHAIN_DEPTH = 3;
var AUTOMATION_ACTOR = "automation";
var uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      const collections = ["organizations", "users", "memberships", "projects", "sprints", "issues", "comments", "activity", "notifications", "filters", "forms", "attachments", "rules", "runs"];
      if (collections.every((k) => Array.isArray(db[k])) && typeof db.sessionUserId === "string") return db;
    }
  } catch {
  }
  const seed = buildSeed();
  persist(seed);
  return seed;
}
function persist(db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
  }
}
var browserStore = { load, save: persist };
var LocalRepository = class {
  constructor(store = browserStore) {
    this.store = store;
    this.db = store.load();
  }
  store;
  db;
  /** The live data object (the server's account service shares it). */
  get snapshot() {
    return this.db;
  }
  save() {
    this.store.save(this.db);
  }
  /** Authorization is re-checked here, as the real backend will do. */
  authorize(orgId, actorId, action) {
    const m = this.db.memberships.find((x) => x.orgId === orgId && x.userId === actorId);
    if (!m) throw new DomainError("You are not a member of this organization.");
    if (!can(m.role, action)) throw new DomainError(`Your role (${m.role}) is not allowed to do this.`);
  }
  issueOrThrow(id) {
    const issue = this.db.issues.find((i) => i.id === id);
    if (!issue) throw new DomainError("Issue not found.");
    return issue;
  }
  projectOrThrow(id) {
    const p = this.db.projects.find((x) => x.id === id);
    if (!p) throw new DomainError("Project not found.");
    return p;
  }
  members(orgId) {
    return this.db.memberships.filter((m) => m.orgId === orgId).map((m) => {
      const { notify: _private, dashboard: _layout, ...user } = this.db.users.find((x) => x.id === m.userId);
      return { ...user, role: m.role, membershipId: m.id };
    });
  }
  isMember(orgId, userId) {
    return this.db.memberships.some((m) => m.orgId === orgId && m.userId === userId);
  }
  async getSessionUserId() {
    return this.db.sessionUserId;
  }
  async setSessionUserId(userId) {
    this.db.sessionUserId = userId;
    this.save();
  }
  async listOrganizations(userId) {
    const orgIds = new Set(this.db.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    return this.db.organizations.filter((o) => orgIds.has(o.id));
  }
  async loadOrg(orgId, userId) {
    if (!this.isMember(orgId, userId)) throw new DomainError("You are not a member of this organization.");
    const org2 = this.db.organizations.find((o) => o.id === orgId);
    const clone = (a) => a.map((x) => ({ ...x }));
    return {
      org: { ...org2 },
      members: this.members(orgId),
      projects: this.db.projects.filter((p) => p.orgId === orgId).map((p) => structuredClone(p)),
      sprints: clone(this.db.sprints.filter((s2) => s2.orgId === orgId)),
      issues: this.db.issues.filter((i) => i.orgId === orgId).map((i) => structuredClone(i)),
      forms: structuredClone(this.db.forms.filter((f) => f.orgId === orgId)),
      // Where the bytes are stored is the server's business, never the browser's.
      attachments: this.db.attachments.filter((a) => a.orgId === orgId).map(({ storageKey: _hidden, ...view }) => ({ ...view })),
      rules: structuredClone(this.db.rules.filter((r) => r.orgId === orgId)),
      runs: clone(this.db.runs.filter((r) => r.orgId === orgId).slice(0, 100)),
      comments: clone(this.db.comments.filter((c) => c.orgId === orgId)),
      activity: clone(this.db.activity.filter((a) => a.orgId === orgId)),
      notifications: clone(this.db.notifications.filter((n) => n.orgId === orgId && n.userId === userId)),
      filters: clone(this.db.filters.filter((f) => f.orgId === orgId && (f.ownerId === userId || f.shared)))
    };
  }
  // ---- members -----------------------------------------------------------
  ownerCount(orgId) {
    return this.db.memberships.filter((m) => m.orgId === orgId && m.role === "owner").length;
  }
  async updateMemberRole(orgId, userId, role, actorId) {
    this.authorize(orgId, actorId, "member.manage");
    if (!["owner", "admin", "member", "guest"].includes(role)) throw new DomainError("Unknown role.");
    const target = this.db.memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw new DomainError("That person is not in this organization.");
    const actor = this.db.memberships.find((m) => m.orgId === orgId && m.userId === actorId);
    if ((role === "owner" || target.role === "owner") && actor.role !== "owner") throw new DomainError("Only an owner can change owner roles.");
    if (target.role === "owner" && role !== "owner" && this.ownerCount(orgId) <= 1) throw new DomainError("An organization needs at least one owner.");
    target.role = role;
    this.save();
  }
  async removeMember(orgId, userId, actorId) {
    if (userId !== actorId) this.authorize(orgId, actorId, "member.manage");
    const target = this.db.memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw new DomainError("That person is not in this organization.");
    const actor = this.db.memberships.find((m) => m.orgId === orgId && m.userId === actorId);
    if (!actor) throw new DomainError("You are not a member of this organization.");
    if (target.role === "owner" && actor.role !== "owner") throw new DomainError("Only an owner can remove an owner.");
    if (target.role === "owner" && this.ownerCount(orgId) <= 1) throw new DomainError("An organization needs at least one owner.");
    this.db.memberships = this.db.memberships.filter((m) => m.id !== target.id);
    for (const i of this.db.issues) {
      if (i.orgId !== orgId) continue;
      if (i.assigneeId === userId) i.assigneeId = void 0;
      if (i.approval) i.approval.approverIds = i.approval.approverIds.filter((a) => a !== userId);
    }
    this.db.filters = this.db.filters.filter((f) => !(f.orgId === orgId && f.ownerId === userId));
    this.db.notifications = this.db.notifications.filter((n) => !(n.orgId === orgId && n.userId === userId));
    this.save();
  }
  // ---- projects --------------------------------------------------------
  async createProject(orgId, input, actorId) {
    this.authorize(orgId, actorId, "project.create");
    const key = input.key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new DomainError("Key must be 2-10 letters/digits and start with a letter.");
    if (this.db.projects.some((p) => p.orgId === orgId && p.key === key)) throw new DomainError(`Key ${key} is already used.`);
    const tpl = TEMPLATES[input.workStyle];
    let statuses = tpl.statuses.map((s2) => ({ ...s2 }));
    let workflow = defaultWorkflow(input.workStyle, statuses);
    if (input.statuses) {
      const problem = columnsProblem(input.statuses);
      if (problem) throw new DomainError(problem);
      const unchanged = input.statuses.length === statuses.length && input.statuses.every((s2, i) => s2.name.trim() === statuses[i].name && s2.category === statuses[i].category);
      if (!unchanged) {
        const built = [];
        for (const s2 of input.statuses) {
          const known = tpl.statuses.find((t2) => t2.name.toLowerCase() === s2.name.trim().toLowerCase() && !built.some((b) => b.id === t2.id));
          built.push({ id: known?.id ?? newStatusId(s2.name, built), name: s2.name.trim(), category: s2.category });
        }
        statuses = built;
        workflow = sanitizeWorkflow({ ...defaultWorkflow(input.workStyle, built), restrict: false, transitions: {} }, built);
      }
    }
    const project = {
      id: uid("p"),
      orgId,
      key,
      name: input.name.trim(),
      description: input.description.trim(),
      color: input.color,
      workStyle: input.workStyle,
      statuses,
      issueTypes: tpl.issueTypes.map((t2) => ({ ...t2 })),
      workflow,
      customFields: defaultCustomFields(input.workStyle),
      leadId: actorId,
      nextNumber: 1,
      createdAt: now()
    };
    this.db.projects.push(project);
    this.save();
    return structuredClone(project);
  }
  /** Removes a column; its cards move to `moveToStatusId` first, so nothing is lost or left stranded. */
  async deleteStatus(projectId, statusId, moveToStatusId, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "project.manage");
    const target = project.statuses.find((s2) => s2.id === statusId);
    if (!target) throw new DomainError("Column not found.");
    const problem = removeProblem(project.statuses, statusId);
    if (problem) throw new DomainError(problem);
    const cards = this.db.issues.filter((i) => i.projectId === projectId && i.statusId === statusId);
    if (cards.length) {
      const dest = project.statuses.find((s2) => s2.id === moveToStatusId && s2.id !== statusId);
      if (!dest) throw new DomainError(`Choose where the ${cards.length} card${cards.length > 1 ? "s" : ""} in \u201C${target.name}\u201D should go.`);
      const top = this.db.issues.filter((i) => i.projectId === projectId && i.statusId === dest.id).reduce((m, i) => Math.max(m, i.rank), 0);
      cards.sort((a, b) => a.rank - b.rank).forEach((i, n) => {
        this.log(i, actorId, "updated", "status", target.name, dest.name);
        i.statusId = dest.id;
        i.rank = top + 1e3 * (n + 1);
        i.resolvedAt = dest.category === "done" ? i.resolvedAt ?? now() : void 0;
        i.updatedAt = now();
      });
    }
    project.statuses = project.statuses.filter((s2) => s2.id !== statusId);
    project.workflow = sanitizeWorkflow(project.workflow, project.statuses);
    this.save();
    return structuredClone(project);
  }
  /** Removes an issue type; items (and request forms) of that type move to `moveToTypeId` first. */
  async deleteIssueType(projectId, typeId, moveToTypeId, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "project.manage");
    const type = project.issueTypes.find((t2) => t2.id === typeId);
    if (!type) throw new DomainError("Type not found.");
    const problem = removeTypeProblem(project.issueTypes, typeId);
    if (problem) throw new DomainError(problem);
    const items = this.db.issues.filter((i) => i.projectId === projectId && i.typeId === typeId);
    const forms = this.db.forms.filter((f) => f.projectId === projectId && f.issueTypeId === typeId);
    let dest;
    if (items.length || forms.length) {
      dest = project.issueTypes.find((t2) => t2.id === moveToTypeId && t2.id !== typeId && (items.length ? t2.level === type.level : t2.level !== 2));
      if (!dest) {
        const what = items.length ? `${items.length} item${items.length > 1 ? "s" : ""}` : `the request form \u201C${forms[0].name}\u201D`;
        throw new DomainError(`Choose another type for ${what} to become.`);
      }
    }
    if (dest) {
      for (const i of items) {
        this.log(i, actorId, "updated", "type", type.name, dest.name);
        i.typeId = dest.id;
        i.updatedAt = now();
      }
      for (const f of forms) f.issueTypeId = dest.id;
    }
    for (const r of this.db.rules.filter((x) => x.projectId === projectId)) {
      for (const c of r.conditions) if (c.field === "type" && [type.id, type.name.toLowerCase()].includes((c.value ?? "").toLowerCase()) && dest) c.value = dest.id;
    }
    project.customFields = project.customFields.map(
      (f) => f.typeIds?.includes(typeId) ? { ...f, typeIds: [...new Set(f.typeIds.map((x) => x === typeId ? dest?.id : x).filter((x) => !!x))] } : f
    );
    project.issueTypes = project.issueTypes.filter((t2) => t2.id !== typeId);
    this.save();
    return structuredClone(project);
  }
  async updateProject(projectId, patch, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "project.manage");
    if (patch.name !== void 0) {
      if (!patch.name.trim()) throw new DomainError("Project name is required.");
      project.name = patch.name.trim();
    }
    if (patch.description !== void 0) project.description = patch.description;
    if (patch.color !== void 0) project.color = patch.color;
    if (patch.statuses) {
      const next = patch.statuses;
      if (next.length < 2) throw new DomainError("A project needs at least two statuses.");
      if (new Set(next.map((s2) => s2.id)).size !== next.length) throw new DomainError("Status ids must be unique.");
      if (next.some((s2) => !s2.name.trim())) throw new DomainError("Every status needs a name.");
      if (new Set(next.map((s2) => s2.name.trim().toLowerCase())).size !== next.length) throw new DomainError("Status names must be unique.");
      if (!next.some((s2) => s2.category === "done")) throw new DomainError('At least one status must be in the "Done" category.');
      const keep = new Set(next.map((s2) => s2.id));
      const orphaned = this.db.issues.filter((i) => i.projectId === projectId && !keep.has(i.statusId));
      if (orphaned.length) {
        const gone = project.statuses.filter((s2) => !keep.has(s2.id) && orphaned.some((i) => i.statusId === s2.id)).map((s2) => s2.name);
        throw new DomainError(`Move issues out of ${gone.join(", ")} before deleting ${gone.length > 1 ? "those statuses" : "that status"} (${orphaned.length} issue${orphaned.length > 1 ? "s" : ""}).`);
      }
      project.statuses = next.map((s2) => ({ ...s2, name: s2.name.trim() }));
      for (const i of this.db.issues.filter((x) => x.projectId === projectId)) {
        const isDone2 = project.statuses.find((s2) => s2.id === i.statusId)?.category === "done";
        i.resolvedAt = isDone2 ? i.resolvedAt ?? now() : void 0;
      }
    }
    if (patch.workflow || patch.statuses) {
      project.workflow = sanitizeWorkflow(patch.workflow ?? project.workflow, project.statuses);
    }
    if (patch.issueTypes) {
      const next = patch.issueTypes;
      const problem = typesProblem(next);
      if (problem) throw new DomainError(problem);
      const used = new Set(this.db.issues.filter((i) => i.projectId === projectId).map((i) => i.typeId));
      const formTypes = new Set(this.db.forms.filter((f) => f.projectId === projectId).map((f) => f.issueTypeId));
      for (const old of project.issueTypes) {
        const kept = next.find((t2) => t2.id === old.id);
        if (!kept) {
          if (used.has(old.id) || formTypes.has(old.id)) throw new DomainError(`\u201C${old.name}\u201D is still in use. Remove it from its own menu so its items can move to another type.`);
        } else if (kept.level !== old.level && used.has(old.id)) {
          throw new DomainError(`\u201C${old.name}\u201D already has items, so it can't change what kind of item it is.`);
        }
      }
      project.issueTypes = next.map((t2) => ({ id: t2.id, name: t2.name.trim(), icon: t2.icon, color: t2.color, level: t2.level, ...t2.kind ? { kind: t2.kind } : {} }));
    }
    if (patch.customFields) {
      const names = /* @__PURE__ */ new Set();
      for (const f of patch.customFields) {
        if (!f.name.trim()) throw new DomainError("Every custom field needs a name.");
        const n = f.name.trim().toLowerCase();
        if (names.has(n)) throw new DomainError(`Duplicate field name "${f.name}".`);
        names.add(n);
        if ((f.type === "select" || f.type === "multiselect") && !(f.options ?? []).length) {
          throw new DomainError(`"${f.name}" needs at least one option.`);
        }
      }
      project.customFields = patch.customFields.map((f) => ({ ...f, name: f.name.trim() }));
      const ids = new Set(project.customFields.map((f) => f.id));
      for (const i of this.db.issues.filter((x) => x.projectId === projectId)) {
        for (const k of Object.keys(i.customFields)) if (!ids.has(k)) delete i.customFields[k];
      }
    }
    this.save();
    return structuredClone(project);
  }
  // ---- issues ----------------------------------------------------------
  async createIssue(orgId, input, actorId) {
    this.authorize(orgId, actorId, "issue.create");
    const project = this.db.projects.find((p) => p.id === input.projectId && p.orgId === orgId);
    if (!project) throw new DomainError("Project not found.");
    if (!input.title.trim()) throw new DomainError("Title is required.");
    if (!project.issueTypes.some((t2) => t2.id === input.typeId)) throw new DomainError("Unknown issue type.");
    const statusId = input.statusId ?? project.statuses[0].id;
    const status = project.statuses.find((s2) => s2.id === statusId);
    if (!status) throw new DomainError("Unknown status.");
    if (input.assigneeId && !this.isMember(orgId, input.assigneeId)) throw new DomainError("Assignee is not in this organization.");
    const fieldErr = validateCustomFields(project, input.typeId, input.customFields ?? {}, { enforceRequired: true });
    if (fieldErr) throw new DomainError(fieldErr);
    const reqErr = checkRequired(project, { assigneeId: input.assigneeId, estimate: input.estimate, dueDate: input.dueDate, description: input.description ?? "" }, statusId);
    if (reqErr) throw new DomainError(reqErr);
    this.checkSprint(project, input.sprintId);
    this.checkParent(project, input.parentId);
    const blockedBy = input.blockedBy ?? [];
    this.checkBlockers(orgId, void 0, blockedBy);
    const approval = input.approverIds?.length ? setApprovers(void 0, this.checkApprovers(orgId, input.approverIds)) : void 0;
    const number = project.nextNumber++;
    const inColumn = this.db.issues.filter((i) => i.projectId === project.id && i.statusId === statusId);
    const issue = {
      id: uid("i"),
      orgId,
      projectId: project.id,
      key: `${project.key}-${number}`,
      number,
      typeId: input.typeId,
      title: input.title.trim(),
      description: input.description ?? "",
      statusId,
      priority: input.priority ?? "medium",
      assigneeId: input.assigneeId,
      reporterId: actorId,
      parentId: input.parentId,
      labels: input.labels ?? [],
      estimate: input.estimate,
      startDate: input.startDate,
      dueDate: input.dueDate,
      customFields: input.customFields ?? {},
      sprintId: input.sprintId,
      blockedBy,
      approval,
      source: input.source,
      rank: this.db.issues.filter((i) => i.projectId === project.id).reduce((m, i) => Math.max(m, i.rank), 0) + 1e3,
      createdAt: now(),
      updatedAt: now(),
      resolvedAt: status.category === "done" ? now() : void 0
    };
    this.db.issues.push(issue);
    this.log(issue, actorId, "created");
    if (issue.assigneeId) this.notify(issue, issue.assigneeId, actorId, "assigned");
    for (const a of approval?.approverIds ?? []) this.notify(issue, a, actorId, "approval", "Your approval is requested");
    this.fireRules({ type: "issue_created", issue }, project, 0, /* @__PURE__ */ new Set());
    this.save();
    return structuredClone(issue);
  }
  /** Throws unless the sprint exists in the project and still accepts work. */
  checkSprint(project, sprintId) {
    if (!sprintId) return;
    const sprint = this.db.sprints.find((s2) => s2.id === sprintId && s2.projectId === project.id);
    if (!sprint) throw new DomainError("Sprint not found in this project.");
    if (sprint.state === "completed") throw new DomainError(`\u201C${sprint.name}\u201D is completed and can't take new work.`);
  }
  /** A parent must be an issue of the same project, and may not be one of the issue's own descendants. */
  checkParent(project, parentId, selfId) {
    if (!parentId) return;
    const parent = this.db.issues.find((i) => i.id === parentId && i.projectId === project.id);
    if (!parent) throw new DomainError("The parent issue was not found in this project.");
    for (let cur = parent; cur; cur = cur.parentId ? this.db.issues.find((i) => i.id === cur.parentId) : void 0) {
      if (selfId && cur.id === selfId) throw new DomainError("That parent would create a loop.");
    }
  }
  checkBlockers(orgId, issueId, blockedBy) {
    for (const id of blockedBy) {
      const b = this.db.issues.find((i) => i.id === id && i.orgId === orgId);
      if (!b) throw new DomainError("A blocking issue was not found.");
      if (id === issueId) throw new DomainError("An issue cannot block itself.");
    }
    if (issueId && wouldCreateCycle(this.db.issues, issueId, blockedBy)) {
      throw new DomainError("That dependency would create a loop (the blocker already depends on this issue).");
    }
  }
  checkApprovers(orgId, ids) {
    for (const id of ids) if (!this.isMember(orgId, id)) throw new DomainError("An approver is not in this organization.");
    return ids;
  }
  async updateIssue(issueId, patch, actorId) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "issue.edit");
    const project = this.projectOrThrow(issue.projectId);
    if (patch.statusId && !project.statuses.some((s2) => s2.id === patch.statusId)) throw new DomainError("Unknown status.");
    if (patch.parentId === issue.id) throw new DomainError("An issue cannot be its own parent.");
    if (patch.parentId) this.checkParent(project, patch.parentId, issue.id);
    if (patch.assigneeId && !this.isMember(issue.orgId, patch.assigneeId)) throw new DomainError("Assignee is not in this organization.");
    if (patch.typeId && !project.issueTypes.some((t2) => t2.id === patch.typeId)) throw new DomainError("Unknown issue type.");
    if ("sprintId" in patch) this.checkSprint(project, patch.sprintId);
    if (patch.blockedBy) this.checkBlockers(issue.orgId, issue.id, patch.blockedBy);
    if (patch.approverIds) this.checkApprovers(issue.orgId, patch.approverIds);
    if (patch.statusId) {
      const err = checkTransition(project, issue, patch.statusId, patch);
      if (err) throw new DomainError(err);
      const gate2 = checkApprovalGate(project, issue, patch.statusId);
      if (gate2) throw new DomainError(gate2);
    }
    if (patch.customFields) {
      const err = validateCustomFields(project, patch.typeId ?? issue.typeId, patch.customFields, { enforceRequired: true });
      if (err) throw new DomainError(err);
    }
    if (!patch.statusId && ("assigneeId" in patch || "estimate" in patch || "dueDate" in patch || "description" in patch)) {
      const err = checkRequired(project, { ...issue, ...patch }, issue.statusId);
      if (err) throw new DomainError(err.replace("Moving to", "Issues in"));
    }
    const label = (field, v) => {
      if (v === void 0 || v === null || v === "") return "";
      if (field === "statusId") return project.statuses.find((s2) => s2.id === v)?.name ?? String(v);
      if (field === "typeId") return project.issueTypes.find((t2) => t2.id === v)?.name ?? String(v);
      if (field === "assigneeId") return this.db.users.find((u) => u.id === v)?.name ?? String(v);
      if (field === "parentId") return this.db.issues.find((i) => i.id === v)?.key ?? String(v);
      if (field === "sprintId") return this.db.sprints.find((s2) => s2.id === v)?.name ?? String(v);
      if (field === "blockedBy" && Array.isArray(v)) return v.map((id) => this.db.issues.find((i) => i.id === id)?.key ?? id).join(", ");
      if (Array.isArray(v)) return v.join(", ");
      return String(v);
    };
    const FIELD_NAME = {
      title: "title",
      description: "description",
      statusId: "status",
      priority: "priority",
      assigneeId: "assignee",
      parentId: "parent",
      typeId: "type",
      labels: "labels",
      estimate: "estimate",
      startDate: "start date",
      dueDate: "due date",
      sprintId: "sprint",
      blockedBy: "blocked by"
    };
    const prevStatus = issue.statusId;
    const prevAssignee = issue.assigneeId;
    const before = structuredClone(issue);
    const { approverIds, ...fields } = patch;
    for (const field of Object.keys(fields)) {
      const next = fields[field];
      const prev = issue[field];
      if (JSON.stringify(prev) === JSON.stringify(next)) continue;
      if (field === "customFields") {
        const defs = project.customFields;
        const before2 = prev ?? {};
        const after = next ?? {};
        for (const d of defs) {
          if (JSON.stringify(before2[d.id] ?? null) !== JSON.stringify(after[d.id] ?? null)) {
            const show = (v) => v === void 0 || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : String(v);
            this.log(issue, actorId, "updated", d.name, show(before2[d.id]), show(after[d.id]));
          }
        }
      } else if (field === "description") {
        this.log(issue, actorId, "updated", "description");
      } else if (FIELD_NAME[field]) {
        this.log(issue, actorId, "updated", FIELD_NAME[field], label(field, prev), label(field, next));
      }
      issue[field] = next;
    }
    if (patch.statusId) {
      const cat = project.statuses.find((s2) => s2.id === patch.statusId).category;
      issue.resolvedAt = cat === "done" ? issue.resolvedAt ?? now() : void 0;
    }
    if ("sprintId" in patch) {
      for (const child of this.db.issues.filter((i) => i.parentId === issue.id)) child.sprintId = issue.sprintId;
    }
    if (approverIds) {
      const before2 = issue.approval?.approverIds ?? [];
      const next = setApprovers(issue.approval, approverIds);
      const name = (id) => this.db.users.find((u) => u.id === id)?.name ?? id;
      if (JSON.stringify(before2) !== JSON.stringify(next.approverIds)) {
        this.log(issue, actorId, "updated", "approvers", before2.map(name).join(", "), next.approverIds.map(name).join(", "));
        for (const a of next.approverIds.filter((x) => !before2.includes(x))) this.notify(issue, a, actorId, "approval", "Your approval is requested");
      }
      issue.approval = next.approverIds.length ? next : void 0;
    }
    issue.updatedAt = now();
    if (issue.assigneeId && issue.assigneeId !== prevAssignee) this.notify(issue, issue.assigneeId, actorId, "assigned");
    if (issue.statusId !== prevStatus) {
      const nm = (id) => project.statuses.find((s2) => s2.id === id)?.name ?? id;
      for (const uid_ of /* @__PURE__ */ new Set([issue.assigneeId, issue.reporterId, ...issue.watcherIds ?? []])) {
        if (uid_ && !(uid_ === issue.assigneeId && issue.assigneeId !== prevAssignee)) {
          this.notify(issue, uid_, actorId, "status", `${nm(prevStatus)} \u2192 ${nm(issue.statusId)}`);
        }
      }
    }
    const fired = /* @__PURE__ */ new Set();
    for (const type of ["status_changed", "assignee_changed", "priority_changed"]) {
      this.fireRules({ type, issue, before }, project, 0, fired);
    }
    this.save();
    return structuredClone(issue);
  }
  // ---- automation ----------------------------------------------------------
  /**
   * Runs every enabled rule of the project that matches `ev`. A rule fires at most once per
   * issue per chain, and chains are capped, so rules can't loop forever.
   */
  fireRules(ev, project, depth, fired) {
    if (depth >= MAX_CHAIN_DEPTH) return;
    for (const rule of this.db.rules.filter((r) => r.projectId === project.id && r.enabled)) {
      const key = `${rule.id}:${ev.issue.id}`;
      if (fired.has(key) || !ruleMatches(rule, ev, project)) continue;
      fired.add(key);
      this.executeRule(rule, ev.issue, project, depth, fired);
    }
  }
  recordRun(rule, issue, result, message) {
    this.db.runs.unshift({
      id: uid("run"),
      orgId: rule.orgId,
      projectId: rule.projectId,
      ruleId: rule.id,
      ruleName: rule.name,
      issueId: issue.id,
      issueKey: issue.key,
      at: now(),
      result,
      message
    });
    if (this.db.runs.length > 1e3) this.db.runs.length = 1e3;
    if (result === "success") rule.runCount += 1;
  }
  executeRule(rule, issue, project, depth, fired) {
    const plan = planActions(rule, issue, project, this.members(issue.orgId));
    const notes = [...plan.errors];
    const patch = { ...plan.patch };
    if (patch.statusId && patch.statusId !== issue.statusId) {
      const blocked = checkRequired(project, { ...issue, ...patch }, patch.statusId) ?? checkApprovalGate(project, issue, patch.statusId);
      if (blocked) {
        notes.push(`Skipped the status change: ${blocked}`);
        delete patch.statusId;
      }
    }
    const before = structuredClone(issue);
    const changes = [];
    const nm = (id) => this.db.users.find((u) => u.id === id)?.name ?? "";
    const sName = (id) => project.statuses.find((s2) => s2.id === id)?.name ?? id;
    if (patch.assigneeId !== void 0 && patch.assigneeId !== issue.assigneeId) {
      this.log(issue, AUTOMATION_ACTOR, "updated", "assignee", nm(issue.assigneeId), nm(patch.assigneeId));
      changes.push(`assigned to ${nm(patch.assigneeId)}`);
      issue.assigneeId = patch.assigneeId;
      this.notify(issue, patch.assigneeId, AUTOMATION_ACTOR, "assigned", `Automation \u201C${rule.name}\u201D`);
    }
    if (patch.priority && patch.priority !== issue.priority) {
      this.log(issue, AUTOMATION_ACTOR, "updated", "priority", issue.priority, patch.priority);
      changes.push(`priority ${patch.priority}`);
      issue.priority = patch.priority;
    }
    if (patch.labels && patch.labels.join("|") !== issue.labels.join("|")) {
      this.log(issue, AUTOMATION_ACTOR, "updated", "labels", issue.labels.join(", "), patch.labels.join(", "));
      changes.push(`labels ${patch.labels.join(", ")}`);
      issue.labels = patch.labels;
    }
    if (patch.statusId && patch.statusId !== issue.statusId) {
      this.log(issue, AUTOMATION_ACTOR, "updated", "status", sName(issue.statusId), sName(patch.statusId));
      changes.push(`moved to ${sName(patch.statusId)}`);
      issue.statusId = patch.statusId;
      const done = project.statuses.find((s2) => s2.id === patch.statusId)?.category === "done";
      issue.resolvedAt = done ? issue.resolvedAt ?? now() : void 0;
    }
    for (const body of plan.comments) {
      this.db.comments.push({ id: uid("c"), orgId: issue.orgId, issueId: issue.id, authorId: AUTOMATION_ACTOR, body, mentions: [], createdAt: now() });
      this.log(issue, AUTOMATION_ACTOR, "commented");
      changes.push("commented");
    }
    for (const userId of new Set(plan.notify)) {
      this.notify(issue, userId, AUTOMATION_ACTOR, "automation", `\u201C${rule.name}\u201D`);
      changes.push(`notified ${nm(userId)}`);
    }
    if (changes.length) issue.updatedAt = now();
    const failed = plan.errors.length > 0;
    this.recordRun(
      rule,
      issue,
      failed ? "error" : changes.length ? "success" : "skipped",
      [changes.length ? changes.join(", ") : "Nothing to change", ...notes].join(" \xB7 ")
    );
    if (changes.length) {
      for (const type of ["status_changed", "assignee_changed", "priority_changed"]) {
        this.fireRules({ type, issue, before }, project, depth + 1, fired);
      }
    }
  }
  // ---- intake forms --------------------------------------------------------
  formOrThrow(id) {
    const f = this.db.forms.find((x) => x.id === id);
    if (!f) throw new DomainError("Form not found.");
    return f;
  }
  slugTaken(orgId, slug2, exceptId) {
    return this.db.forms.some((f) => f.orgId === orgId && f.slug === slug2 && f.id !== exceptId);
  }
  async createForm(projectId, input, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "project.manage");
    const slug2 = input.slug?.trim() || slugify(input.name);
    const err = validateForm({ ...input, slug: slug2 }, project);
    if (err) throw new DomainError(err);
    if (this.slugTaken(project.orgId, slug2)) throw new DomainError(`The link name \u201C${slug2}\u201D is already used.`);
    if (input.defaultAssigneeId && !this.isMember(project.orgId, input.defaultAssigneeId)) throw new DomainError("The default assignee is not in this organization.");
    const form = {
      id: uid("form"),
      orgId: project.orgId,
      projectId,
      slug: slug2,
      name: input.name.trim(),
      description: input.description.trim(),
      enabled: input.enabled ?? true,
      fields: input.fields,
      issueTypeId: input.issueTypeId,
      defaultPriority: input.defaultPriority,
      defaultAssigneeId: input.defaultAssigneeId,
      createdBy: actorId,
      createdAt: now(),
      submissionCount: 0
    };
    this.db.forms.push(form);
    this.save();
    return structuredClone(form);
  }
  async updateForm(formId, patch, actorId) {
    const form = this.formOrThrow(formId);
    this.authorize(form.orgId, actorId, "project.manage");
    const project = this.projectOrThrow(form.projectId);
    const next = { ...form, ...patch };
    const err = validateForm(next, project);
    if (err) throw new DomainError(err);
    if (this.slugTaken(form.orgId, next.slug, form.id)) throw new DomainError(`The link name \u201C${next.slug}\u201D is already used.`);
    Object.assign(form, { ...patch, name: next.name.trim() });
    this.save();
    return structuredClone(form);
  }
  async deleteForm(formId, actorId) {
    const form = this.formOrThrow(formId);
    this.authorize(form.orgId, actorId, "project.manage");
    this.db.forms = this.db.forms.filter((f) => f.id !== formId);
    this.save();
  }
  publicFormOrThrow(orgSlug, formSlug) {
    const org2 = this.db.organizations.find((o) => o.slug === orgSlug);
    const form = org2 && this.db.forms.find((f) => f.orgId === org2.id && f.slug === formSlug);
    if (!org2 || !form || !form.enabled) throw new DomainError("This form is not available.");
    return { org: org2, form, project: this.projectOrThrow(form.projectId) };
  }
  async getPublicForm(orgSlug, formSlug) {
    const { org: org2, form, project } = this.publicFormOrThrow(orgSlug, formSlug);
    return {
      orgName: org2.name,
      projectName: project.name,
      form: { id: form.id, slug: form.slug, name: form.name, description: form.description, fields: structuredClone(form.fields) }
    };
  }
  async submitForm(orgSlug, formSlug, answers, submitter, honeypot) {
    const { org: org2, form, project } = this.publicFormOrThrow(orgSlug, formSlug);
    if (honeypot?.trim()) return { key: `${project.key}-0` };
    const err = validateSubmission(form, answers, submitter);
    if (err) throw new DomainError(err);
    const hourAgo = Date.now() - 36e5;
    const recent = this.db.issues.filter((i) => i.source?.formId === form.id && new Date(i.createdAt).getTime() > hourAgo).length;
    if (recent >= MAX_SUBMISSIONS_PER_HOUR) throw new DomainError("Too many requests right now. Please try again later.");
    const input = buildIssue(form, project, answers, submitter);
    input.source = { formId: form.id, formName: form.name, submitterName: submitter.name.trim(), submitterEmail: submitter.email.trim() };
    let issue;
    try {
      issue = await this.createIssue(org2.id, input, form.createdBy);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      throw new DomainError(/not allowed|not a member/.test(msg) ? "This form is temporarily unavailable." : msg || "Could not submit the request.");
    }
    form.submissionCount += 1;
    const stored = this.db.issues.find((i) => i.id === issue.id);
    for (const to of /* @__PURE__ */ new Set([project.leadId, form.createdBy])) this.notify(stored, to, "intake", "intake", `${submitter.name.trim()} via \u201C${form.name}\u201D`);
    this.save();
    return { key: issue.key };
  }
  async createRule(projectId, input, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "automation.manage");
    const err = validateRule(input, project);
    if (err) throw new DomainError(err);
    const rule = {
      id: uid("r"),
      orgId: project.orgId,
      projectId,
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions,
      createdBy: actorId,
      createdAt: now(),
      runCount: 0
    };
    this.db.rules.push(rule);
    this.save();
    return structuredClone(rule);
  }
  async updateRule(ruleId, patch, actorId) {
    const rule = this.db.rules.find((r) => r.id === ruleId);
    if (!rule) throw new DomainError("Rule not found.");
    this.authorize(rule.orgId, actorId, "automation.manage");
    const project = this.projectOrThrow(rule.projectId);
    const next = { ...rule, ...patch };
    const err = validateRule(next, project);
    if (err) throw new DomainError(err);
    Object.assign(rule, { ...patch, name: next.name.trim() });
    this.save();
    return structuredClone(rule);
  }
  async deleteRule(ruleId, actorId) {
    const rule = this.db.rules.find((r) => r.id === ruleId);
    if (!rule) throw new DomainError("Rule not found.");
    this.authorize(rule.orgId, actorId, "automation.manage");
    this.db.rules = this.db.rules.filter((r) => r.id !== ruleId);
    this.save();
  }
  async runScheduledAutomations(orgId, actorId) {
    if (!this.isMember(orgId, actorId)) throw new DomainError("You are not a member of this organization.");
    const today = now().slice(0, 10);
    let changed = 0;
    for (const rule of this.db.rules.filter((r) => r.orgId === orgId && r.enabled && r.trigger.type === "due_date_passed")) {
      const project = this.projectOrThrow(rule.projectId);
      for (const issue of this.db.issues.filter((i) => i.projectId === rule.projectId)) {
        if (!issue.dueDate || issue.dueDate >= today || isDone(project, issue)) continue;
        if (this.db.runs.some((r) => r.ruleId === rule.id && r.issueId === issue.id && r.result !== "error")) continue;
        if (!ruleMatches(rule, { type: "due_date_passed", issue }, project)) continue;
        this.executeRule(rule, issue, project, 0, /* @__PURE__ */ new Set([`${rule.id}:${issue.id}`]));
        changed += 1;
      }
    }
    if (changed) this.save();
    return changed;
  }
  /**
   * Reminds assignees about unfinished work that is due tomorrow, due today, or has just become overdue.
   * Each stage is sent once per item and due date (moving the date re-arms it). Called by the server on a timer,
   * never by a browser. `today` is "YYYY-MM-DD". Returns how many reminders were created.
   */
  createDueReminders(orgId, at) {
    let created = 0;
    const remind = (issue, userId, detail) => {
      if (this.db.notifications.some((n) => n.kind === "due" && n.issueId === issue.id && n.userId === userId && n.detail === detail)) return;
      const before = this.db.notifications.length;
      this.notify(issue, userId, "reminder", "due", detail);
      created += this.db.notifications.length - before;
    };
    for (const issue of this.db.issues.filter((i) => i.orgId === orgId && i.dueDate)) {
      const project = this.db.projects.find((p) => p.id === issue.projectId);
      if (!project || isDone(project, issue)) continue;
      const due = issue.dueDate;
      const day = (userId) => localDate(at, resolvePrefs(this.db.users.find((u) => u.id === userId)).timeZone);
      if (issue.assigneeId) {
        const prefs = resolvePrefs(this.db.users.find((u) => u.id === issue.assigneeId));
        const lead = prefs.dueLeadDays ?? 1;
        const today = day(issue.assigneeId);
        const tomorrow = nextDay(today);
        let soonest = today;
        for (let n = 0; n < lead; n++) soonest = nextDay(soonest);
        const detail = due < today ? `Overdue since ${due}` : due === today ? `Due today (${due})` : due === tomorrow && lead === 1 ? `Due tomorrow (${due})` : due > today && due <= soonest ? due === tomorrow ? `Due tomorrow (${due})` : `Due soon (${due})` : null;
        const stable = detail && due > today && due !== tomorrow ? `Due soon (${due})` : detail && due === tomorrow && lead > 1 ? `Due soon (${due})` : detail;
        if (stable) remind(issue, issue.assigneeId, stable);
      }
      for (const id of /* @__PURE__ */ new Set([issue.reporterId, ...issue.watcherIds ?? []])) {
        if (id && id !== issue.assigneeId && due < day(id)) remind(issue, id, `Overdue since ${due}`);
      }
    }
    if (created) this.save();
    return created;
  }
  /** Follow or stop following an item: followers are told about its comments and status changes. Anyone in the organization can follow. */
  async setWatching(issueId, watching, actorId) {
    const issue = this.issueOrThrow(issueId);
    if (!this.isMember(issue.orgId, actorId)) throw new DomainError("You are not a member of this organization.");
    const now0 = issue.watcherIds ?? [];
    issue.watcherIds = watching ? [.../* @__PURE__ */ new Set([...now0, actorId])] : now0.filter((id) => id !== actorId);
    this.save();
    return structuredClone(issue);
  }
  /** Adds your reaction to a comment, or takes it back if you already used it. Only a small set of emoji is accepted. */
  async toggleReaction(commentId, emoji, actorId) {
    const comment = this.db.comments.find((c) => c.id === commentId);
    if (!comment) throw new DomainError("Comment not found.");
    this.authorize(comment.orgId, actorId, "comment.add");
    if (!REACTIONS.includes(emoji)) throw new DomainError("Choose one of the offered reactions.");
    const reactions = { ...comment.reactions ?? {} };
    const mine = reactions[emoji] ?? [];
    const next = mine.includes(actorId) ? mine.filter((id) => id !== actorId) : [...mine, actorId];
    if (next.length) reactions[emoji] = next;
    else delete reactions[emoji];
    comment.reactions = reactions;
    this.save();
    return structuredClone(comment);
  }
  async deleteIssue(issueId, actorId) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "issue.delete");
    this.db.issues.forEach((i) => {
      if (i.parentId === issueId) i.parentId = void 0;
      i.blockedBy = i.blockedBy.filter((b) => b !== issueId);
    });
    this.db.issues = this.db.issues.filter((i) => i.id !== issueId);
    this.db.comments = this.db.comments.filter((c) => c.issueId !== issueId);
    this.db.activity = this.db.activity.filter((a) => a.issueId !== issueId);
    for (const a of this.db.attachments.filter((x) => x.issueId === issueId)) this.pendingFiles.push({ orgId: a.orgId, storageKey: a.storageKey });
    this.db.attachments = this.db.attachments.filter((a) => a.issueId !== issueId);
    this.db.notifications = this.db.notifications.filter((n) => n.issueId !== issueId);
    this.save();
  }
  async addComment(issueId, body, actorId) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "comment.add");
    if (!body.trim()) throw new DomainError("Comment is empty.");
    const mentions = extractMentions(body, this.members(issue.orgId)).filter((id) => id !== actorId);
    const comment = { id: uid("c"), orgId: issue.orgId, issueId, authorId: actorId, body: body.trim(), mentions, createdAt: now() };
    this.db.comments.push(comment);
    this.log(issue, actorId, "commented");
    const preview = comment.body.replace(/\s+/g, " ").slice(0, 120);
    for (const id of mentions) this.notify(issue, id, actorId, "mention", preview);
    for (const id of /* @__PURE__ */ new Set([issue.assigneeId, issue.reporterId, ...issue.watcherIds ?? []])) {
      if (id && !mentions.includes(id)) this.notify(issue, id, actorId, "comment", preview);
    }
    if (!(issue.watcherIds ?? []).includes(actorId) && actorId !== issue.assigneeId && actorId !== issue.reporterId) issue.watcherIds = [...issue.watcherIds ?? [], actorId];
    this.save();
    return { ...comment };
  }
  // ---- attachments ---------------------------------------------------------
  /** Files whose records were removed and whose bytes the server should now delete. */
  pendingFiles = [];
  drainFileDeletions() {
    const out = this.pendingFiles;
    this.pendingFiles = [];
    return out;
  }
  /** Total bytes an organization has stored (used for its quota). */
  orgStorageUsed(orgId) {
    return this.db.attachments.filter((a) => a.orgId === orgId).reduce((s2, a) => s2 + a.size, 0);
  }
  /**
   * Records a file whose bytes the server has already written. Called by the server's upload
   * route only. Re-checks who may attach and enforces the per-issue and per-organization limits.
   */
  async registerAttachment(issueId, file, limits, actorId, opts = {}) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "issue.edit");
    if (opts.commentId) {
      const comment = this.db.comments.find((c) => c.id === opts.commentId);
      if (!comment || comment.issueId !== issueId) throw new DomainError("Comment not found.");
      if (comment.authorId !== actorId) throw new DomainError("You can only attach files to your own comments.");
    }
    const problem = fileProblem(file.name, file.size, limits);
    if (problem) throw new DomainError(problem);
    if (this.db.attachments.filter((a) => a.issueId === issueId).length >= limits.maxFilesPerIssue) {
      throw new DomainError(`An item can have up to ${limits.maxFilesPerIssue} files. Remove one first.`);
    }
    if (this.orgStorageUsed(issue.orgId) + file.size > limits.orgQuotaBytes) {
      throw new DomainError(`Your organization's file storage (${formatBytes(limits.orgQuotaBytes)}) is full. Remove some files first.`);
    }
    const att = {
      id: uid("att"),
      orgId: issue.orgId,
      projectId: issue.projectId,
      issueId,
      ...opts.commentId ? { commentId: opts.commentId } : {},
      ...opts.externalName ? { externalName: opts.externalName.slice(0, 100) } : {},
      name: cleanFileName(file.name),
      size: file.size,
      mime: file.mime,
      uploaderId: actorId,
      createdAt: now(),
      storageKey: file.storageKey,
      sha256: file.sha256
    };
    this.db.attachments.push(att);
    this.log(issue, opts.externalName ? "intake" : actorId, "updated", "attachment", "", att.name);
    issue.updatedAt = now();
    this.save();
    const { storageKey: _hidden, ...view } = att;
    void _hidden;
    return view;
  }
  /** Throws unless this person may attach files to the issue. Checked before any bytes are written. */
  assertCanAttach(issueId, actorId) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "issue.edit");
    return { orgId: issue.orgId };
  }
  /** The uploader, or a project admin, may remove a file. */
  async deleteAttachment(attachmentId, actorId) {
    const att = this.db.attachments.find((a) => a.id === attachmentId);
    if (!att) throw new DomainError("File not found.");
    const mine = att.uploaderId === actorId;
    if (mine) this.authorize(att.orgId, actorId, "issue.edit");
    else this.authorize(att.orgId, actorId, "project.manage");
    const issue = this.db.issues.find((i) => i.id === att.issueId);
    if (issue) {
      this.log(issue, actorId, "updated", "attachment", att.name, "");
      issue.updatedAt = now();
    }
    this.db.attachments = this.db.attachments.filter((a) => a.id !== attachmentId);
    this.pendingFiles.push({ orgId: att.orgId, storageKey: att.storageKey });
    this.save();
  }
  /** Looks a file up for download. Only members of its organization get it. */
  findAttachmentFor(attachmentId, userId) {
    const att = this.db.attachments.find((a) => a.id === attachmentId);
    return att && this.isMember(att.orgId, userId) ? att : void 0;
  }
  // ---- notifications & filters ----------------------------------------
  async markNotificationRead(notificationId, actorId) {
    const n = this.db.notifications.find((x) => x.id === notificationId);
    if (!n || n.userId !== actorId) throw new DomainError("Notification not found.");
    n.read = true;
    this.save();
  }
  async markAllNotificationsRead(orgId, actorId) {
    this.db.notifications.forEach((n) => {
      if (n.orgId === orgId && n.userId === actorId) n.read = true;
    });
    this.save();
  }
  /** Saves how this person arranged their Home dashboard. Anything not a well-formed layout is refused. */
  async setDashboardLayout(layout, actorId) {
    const user = this.db.users.find((u) => u.id === actorId);
    if (!user) throw new DomainError("Account not found.");
    try {
      if (layout === null) delete user.dashboard;
      else user.dashboard = validateLayout(layout);
    } catch (e) {
      throw new DomainError(e.message);
    }
    this.save();
    return { ...user };
  }
  async setNotifyPrefs(prefs, actorId) {
    const user = this.db.users.find((u) => u.id === actorId);
    if (!user) throw new DomainError("Account not found.");
    let clean;
    try {
      clean = validatePrefs(prefs);
    } catch (e) {
      throw new DomainError(e.message);
    }
    user.notify = clean;
    this.save();
    return { ...user };
  }
  async saveFilter(orgId, input, actorId) {
    if (!this.isMember(orgId, actorId)) throw new DomainError("You are not a member of this organization.");
    if (!input.name.trim()) throw new DomainError("Give the filter a name.");
    if (input.shared) this.authorize(orgId, actorId, "filter.share");
    const f = { id: uid("f"), orgId, ownerId: actorId, name: input.name.trim(), query: input.query, shared: input.shared, createdAt: now() };
    this.db.filters.push(f);
    this.save();
    return { ...f };
  }
  async deleteFilter(filterId, actorId) {
    const f = this.db.filters.find((x) => x.id === filterId);
    if (!f) throw new DomainError("Filter not found.");
    const isAdmin = can(this.db.memberships.find((m) => m.orgId === f.orgId && m.userId === actorId)?.role, "project.manage");
    if (f.ownerId !== actorId && !isAdmin) throw new DomainError("Only the owner or an admin can delete this filter.");
    this.db.filters = this.db.filters.filter((x) => x.id !== filterId);
    this.save();
  }
  // ---- sprints -----------------------------------------------------------
  sprintOrThrow(id) {
    const s2 = this.db.sprints.find((x) => x.id === id);
    if (!s2) throw new DomainError("Sprint not found.");
    return s2;
  }
  async createSprint(projectId, input, actorId) {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, "sprint.manage");
    if (!input.name.trim()) throw new DomainError("Sprint name is required.");
    const dateErr = validateSprintDates(input.startDate, input.endDate);
    if (dateErr) throw new DomainError(dateErr);
    const sprint = {
      id: uid("sp"),
      orgId: project.orgId,
      projectId,
      name: input.name.trim(),
      goal: input.goal?.trim() ?? "",
      startDate: input.startDate,
      endDate: input.endDate,
      state: "planned",
      createdAt: now()
    };
    this.db.sprints.push(sprint);
    this.save();
    return { ...sprint };
  }
  async updateSprint(sprintId, patch, actorId) {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, "sprint.manage");
    if (sprint.state === "completed") throw new DomainError("A completed sprint cannot be edited.");
    const next = { ...sprint, ...patch };
    if (!next.name.trim()) throw new DomainError("Sprint name is required.");
    const dateErr = validateSprintDates(next.startDate, next.endDate);
    if (dateErr) throw new DomainError(dateErr);
    Object.assign(sprint, { ...patch, name: next.name.trim() });
    this.save();
    return { ...sprint };
  }
  async startSprint(sprintId, actorId) {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, "sprint.manage");
    const err = checkStart(sprint, this.db.sprints.filter((s2) => s2.projectId === sprint.projectId));
    if (err) throw new DomainError(err);
    const project = this.projectOrThrow(sprint.projectId);
    sprint.state = "active";
    sprint.startedAt = now();
    sprint.committedPoints = sprintStats(project, this.db.issues, sprint.id).points;
    this.save();
    return { ...sprint };
  }
  async completeSprint(sprintId, moveToSprintId, actorId) {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, "sprint.manage");
    if (sprint.state !== "active") throw new DomainError("Only an active sprint can be completed.");
    const project = this.projectOrThrow(sprint.projectId);
    if (moveToSprintId) {
      const target = this.sprintOrThrow(moveToSprintId);
      if (target.projectId !== sprint.projectId || target.state !== "planned") throw new DomainError("Unfinished work can only move to a planned sprint.");
    }
    sprint.completedPoints = sprintStats(project, this.db.issues, sprint.id).donePoints;
    for (const issue of this.db.issues.filter((i) => i.sprintId === sprint.id && !isDone(project, i))) {
      this.log(issue, actorId, "updated", "sprint", sprint.name, moveToSprintId ? this.sprintOrThrow(moveToSprintId).name : "");
      issue.sprintId = moveToSprintId ?? void 0;
    }
    sprint.state = "completed";
    sprint.completedAt = now();
    this.save();
    return { ...sprint };
  }
  async deleteSprint(sprintId, actorId) {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, "sprint.manage");
    if (sprint.state !== "planned") throw new DomainError("Only a planned sprint can be deleted.");
    this.db.issues.forEach((i) => {
      if (i.sprintId === sprintId) i.sprintId = void 0;
    });
    this.db.sprints = this.db.sprints.filter((s2) => s2.id !== sprintId);
    this.save();
  }
  // ---- approvals ---------------------------------------------------------
  async decideApproval(issueId, decision, comment, actorId) {
    const issue = this.issueOrThrow(issueId);
    if (!this.isMember(issue.orgId, actorId)) throw new DomainError("You are not a member of this organization.");
    if (!issue.approval) throw new DomainError("This item does not need approval.");
    if (decision === "rejected" && !comment?.trim()) throw new DomainError("Please explain why you are rejecting.");
    const project = this.projectOrThrow(issue.projectId);
    issue.approval = applyDecision(issue.approval, actorId, decision, comment, now());
    const state = approvalState(issue.approval);
    this.log(issue, actorId, "updated", "approval", "", decision + (comment?.trim() ? `: ${comment.trim()}` : ""));
    const target = state === "approved" ? project.statuses.find((s2) => s2.category === "done") : state === "rejected" ? project.statuses.find((s2) => s2.category === "todo") : void 0;
    if (target && issue.statusId !== target.id) {
      this.log(issue, actorId, "updated", "status", project.statuses.find((s2) => s2.id === issue.statusId)?.name ?? "", target.name);
      issue.statusId = target.id;
      issue.resolvedAt = target.category === "done" ? now() : void 0;
    }
    issue.updatedAt = now();
    const who = this.db.users.find((u) => u.id === actorId)?.name ?? "Someone";
    const detail = `${who} ${decision}${state === "approved" ? " \xB7 fully approved" : ""}`;
    for (const id of /* @__PURE__ */ new Set([issue.reporterId, issue.assigneeId])) if (id) this.notify(issue, id, actorId, "approval", detail);
    this.save();
    return structuredClone(issue);
  }
  async resetApproval(issueId, actorId) {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, "issue.edit");
    if (!issue.approval) throw new DomainError("This item does not need approval.");
    issue.approval = resetDecisions(issue.approval);
    this.log(issue, actorId, "updated", "approval", "", "requested again");
    for (const a of issue.approval.approverIds) this.notify(issue, a, actorId, "approval", "Your approval is requested again");
    issue.updatedAt = now();
    this.save();
    return structuredClone(issue);
  }
  async resetDemo() {
    this.db = buildSeed();
    this.save();
  }
  // ---- internals -------------------------------------------------------
  notify(issue, userId, actorId, kind, detail) {
    if (userId === actorId || !this.isMember(issue.orgId, userId)) return;
    const n = {
      id: uid("n"),
      orgId: issue.orgId,
      userId,
      actorId,
      issueId: issue.id,
      projectId: issue.projectId,
      kind,
      detail,
      read: false,
      createdAt: now()
    };
    this.db.notifications.push(n);
  }
  log(issue, actorId, kind, field, from, to) {
    this.db.activity.push({
      id: uid("a"),
      orgId: issue.orgId,
      projectId: issue.projectId,
      issueId: issue.id,
      actorId,
      kind,
      field,
      from,
      to,
      createdAt: now()
    });
  }
};

// server/auth.ts
var import_node_crypto = require("node:crypto");
var SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
var scryptAsync = (password, salt) => new Promise(
  (resolve, reject) => (0, import_node_crypto.scrypt)(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => err ? reject(err) : resolve(key))
);
async function hashPassword(password) {
  const salt = (0, import_node_crypto.randomBytes)(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function verifyPassword(password, stored) {
  const [alg, , , , saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  return actual.length === expected.length && (0, import_node_crypto.timingSafeEqual)(actual, expected);
}
var dummyHash = null;
var getDummyHash = () => dummyHash ??= hashPassword("not-a-real-password");
function passwordProblem(password) {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < 10) return "Use at least 10 characters for your password.";
  if (password.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(password)) return "Choose a less repetitive password.";
  return null;
}
var newToken = () => (0, import_node_crypto.randomBytes)(32).toString("base64url");
var hashToken = (t2) => (0, import_node_crypto.createHash)("sha256").update(t2).digest("hex");
var newId = (p) => `${p}_${(0, import_node_crypto.randomBytes)(6).toString("hex")}`;
var SESSION_DAYS = 14;
async function createSession(db, userId, meta = {}) {
  const token = newToken();
  await db.query(`insert into sessions (token_hash, user_id, expires_at, user_agent, ip) values ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`, [
    hashToken(token),
    userId,
    String(SESSION_DAYS),
    (meta.userAgent ?? "").slice(0, 300) || null,
    (meta.ip ?? "").slice(0, 64) || null
  ]);
  return token;
}
function deviceName(userAgent) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
async function listSessions(db, userId, currentToken) {
  const mine = currentToken ? hashToken(currentToken) : "";
  const rows = await db.query(`select token_hash, user_agent, ip, created_at from sessions where user_id = $1 and expires_at > now() order by created_at desc`, [userId]);
  return rows.map((r) => ({
    id: String(r.token_hash).slice(0, 16),
    device: deviceName(r.user_agent),
    ip: String(r.ip ?? ""),
    createdAt: new Date(String(r.created_at)).toISOString(),
    current: String(r.token_hash) === mine
  }));
}
async function revokeSession(db, userId, id, currentToken) {
  if (!/^[a-f0-9]{16}$/.test(id)) return false;
  const rows = await db.query(`delete from sessions where user_id = $1 and token_hash like $2 and token_hash <> $3 returning token_hash`, [userId, `${id}%`, currentToken ? hashToken(currentToken) : ""]);
  return rows.length > 0;
}
async function sessionUser(db, token) {
  if (!token) return null;
  const rows = await db.query(`select user_id from sessions where token_hash = $1 and expires_at > now()`, [hashToken(token)]);
  return rows.length ? String(rows[0].user_id) : null;
}
async function deleteSession(db, token) {
  if (token) await db.query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
}
async function deleteUserSessions(db, userId, exceptToken) {
  if (exceptToken) await db.query(`delete from sessions where user_id = $1 and token_hash <> $2`, [userId, hashToken(exceptToken)]);
  else await db.query(`delete from sessions where user_id = $1`, [userId]);
}
async function purgeExpired(db) {
  await db.query(`delete from sessions where expires_at <= now()`);
  await db.query(`delete from invites where expires_at <= now() and accepted_at is null`);
  await db.query(`delete from password_resets where expires_at <= now()`);
}
var RateLimiter = class {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
  }
  max;
  windowMs;
  hits = /* @__PURE__ */ new Map();
  /** Records an attempt; returns false when the key is over its limit. */
  allow(key, now2 = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t2) => now2 - t2 < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now2);
    this.hits.set(key, recent);
    if (this.hits.size > 1e4) this.hits.clear();
    return true;
  }
  reset(key) {
    this.hits.delete(key);
  }
};

// server/accounts.ts
var import_qrcode = __toESM(require("qrcode"), 1);

// server/twofactor.ts
var import_node_crypto2 = require("node:crypto");
var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[value << 5 - bits & 31];
  return out;
}
function base32Decode(text2) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text2.toUpperCase().replace(/[\s=-]/g, "")) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not base32.");
    value = value << 5 | i;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
var STEP_SECONDS = 30;
var stepOf = (at) => Math.floor(at / 1e3 / STEP_SECONDS);
function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = (0, import_node_crypto2.createHmac)("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = (h[off] & 127) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3];
  return String(n % 1e6).padStart(6, "0");
}
function matchStep(secret, code, at) {
  if (!/^\d{6}$/.test(code)) return null;
  const now2 = stepOf(at);
  for (const s2 of [now2, now2 - 1, now2 + 1]) {
    const want = Buffer.from(hotp(secret, s2));
    if ((0, import_node_crypto2.timingSafeEqual)(want, Buffer.from(code))) return s2;
  }
  return null;
}
var otpauthUri = (secretB32, account, issuer = "ABG Tracker") => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
var RECOVERY_COUNT = 8;
var hashCode = (code) => (0, import_node_crypto2.createHash)("sha256").update(code).digest("hex");
var normRecovery = (c) => c.replace(/[\s-]/g, "").toLowerCase();
var TwoFactor = class {
  constructor(db) {
    this.db = db;
  }
  db;
  key = null;
  getKey() {
    this.key ??= (async () => {
      await this.db.query(`insert into app_secrets (name, value) values ('totp-key', $1) on conflict (name) do nothing`, [(0, import_node_crypto2.randomBytes)(32).toString("hex")]);
      return Buffer.from(String((await this.db.query(`select value from app_secrets where name = 'totp-key'`))[0].value), "hex");
    })().catch((e) => {
      this.key = null;
      throw e;
    });
    return this.key;
  }
  async seal(plain) {
    const iv = (0, import_node_crypto2.randomBytes)(12);
    const c = (0, import_node_crypto2.createCipheriv)("aes-256-gcm", await this.getKey(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
  }
  async open(sealed) {
    const raw = Buffer.from(sealed, "base64");
    const d = (0, import_node_crypto2.createDecipheriv)("aes-256-gcm", await this.getKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  }
  async isEnabled(userId) {
    const r = await this.db.query(`select enabled from two_factor where user_id = $1`, [userId]);
    return r.length > 0 && r[0].enabled === true;
  }
  /** Starts set-up: makes a fresh secret that does nothing until a first code proves the phone has it. */
  async begin(userId) {
    if (await this.isEnabled(userId)) throw new Error("Two-factor sign-in is already on.");
    const secret = base32Encode((0, import_node_crypto2.randomBytes)(20));
    await this.db.query(
      `insert into two_factor (user_id, secret_enc, enabled, last_step) values ($1, $2, false, 0)
       on conflict (user_id) do update set secret_enc = excluded.secret_enc, enabled = false, last_step = 0`,
      [userId, await this.seal(secret)]
    );
    return secret;
  }
  /** Checks a code against the stored secret; true at most once per 30-second step. */
  async verifyTotp(userId, code, at) {
    const r = await this.db.query(`select secret_enc, last_step from two_factor where user_id = $1`, [userId]);
    if (!r.length) return false;
    const step = matchStep(base32Decode(await this.open(String(r[0].secret_enc))), code, at);
    if (step === null || step <= Number(r[0].last_step)) return false;
    const claimed = await this.db.query(`update two_factor set last_step = $2 where user_id = $1 and last_step < $2 returning user_id`, [userId, step]);
    return claimed.length > 0;
  }
  /** Turns it on after the first correct code, and returns the one-time recovery codes (shown once, never again). */
  async confirm(userId, code, at = Date.now()) {
    const r = await this.db.query(`select enabled from two_factor where user_id = $1`, [userId]);
    if (!r.length || r[0].enabled === true) return null;
    if (!await this.verifyTotp(userId, code, at)) return null;
    const codes = Array.from({ length: RECOVERY_COUNT }, () => {
      const raw = base32Encode((0, import_node_crypto2.randomBytes)(7)).slice(0, 10).toLowerCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.db.tx(async (q) => {
      await q(`delete from recovery_codes where user_id = $1`, [userId]);
      for (const c of codes) await q(`insert into recovery_codes (user_id, code_hash) values ($1, $2)`, [userId, hashCode(normRecovery(c))]);
      await q(`update two_factor set enabled = true where user_id = $1`, [userId]);
    });
    return codes;
  }
  /** A sign-in code from the app, or a recovery code (which is used up by being accepted). */
  async check(userId, code, at = Date.now()) {
    if (typeof code !== "string" || code.length > 40) return false;
    const trimmed = code.replace(/\s/g, "");
    if (/^\d{6}$/.test(trimmed)) return this.verifyTotp(userId, trimmed, at);
    const used = await this.db.query(`update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning code_hash`, [userId, hashCode(normRecovery(code))]);
    return used.length > 0;
  }
  async recoveryLeft(userId) {
    return Number((await this.db.query(`select count(*) as n from recovery_codes where user_id = $1 and used_at is null`, [userId]))[0].n);
  }
  async disable(userId) {
    await this.db.query(`delete from two_factor where user_id = $1`, [userId]);
    await this.db.query(`delete from recovery_codes where user_id = $1`, [userId]);
  }
};

// server/mailer.ts
var import_nodemailer = __toESM(require("nodemailer"), 1);
var ConsoleMailer = class {
  /**
   * `verbose` prints the whole message (links included) for developers. In production it must be
   * off: reset and invitation links are credentials, and logs are widely readable.
   */
  constructor(log = (l) => console.log(l), verbose = true) {
    this.log = log;
    this.verbose = verbose;
  }
  log;
  verbose;
  kind = "console";
  outbox = [];
  async send(msg) {
    if (this.verbose) {
      this.outbox.unshift({ ...msg, at: (/* @__PURE__ */ new Date()).toISOString() });
      this.outbox.length = Math.min(this.outbox.length, 50);
      this.log(`[mail not sent: no SMTP_URL] to=${msg.to} subject="${msg.subject}"
${msg.text}`);
    } else {
      this.log(`[mail not sent: SMTP_URL is not configured] subject="${msg.subject}"`);
    }
  }
};
var SmtpMailer = class {
  constructor(url, from) {
    this.from = from;
    this.transport = import_nodemailer.default.createTransport(url);
  }
  from;
  kind = "smtp";
  transport;
  async send(msg) {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, headers: msg.headers });
  }
};
var createMailer = (smtpUrl, from, opts) => smtpUrl ? new SmtpMailer(smtpUrl, from) : new ConsoleMailer(opts.log, opts.verbose);

// server/errors.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};

// server/accounts.ts
var COLORS = ["#0d3133", "#7c5cd6", "#2f9e6b", "#e8833a", "#dc4b4b", "#3b82f6", "#0f8b8d"];
var RESERVED_SLUGS = /* @__PURE__ */ new Set(["forms", "invite", "api", "login", "register", "signup", "assets", "admin", "static", "health"]);
var EMAIL_RE2 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var INVITE_DAYS = 7;
var DEMO_PASSWORD = "demo-password-1";
var normEmail = (e) => {
  if (typeof e !== "string") throw new HttpError(400, "Email is required.");
  const v = e.trim().toLowerCase();
  if (!EMAIL_RE2.test(v) || v.length > 200) throw new HttpError(400, "Enter a valid email address.");
  return v;
};
var cleanName = (n, label, min = 1, max = 100) => {
  if (typeof n !== "string" || n.trim().length < min || n.trim().length > max) throw new HttpError(400, `${label} must be ${min}-${max} characters.`);
  return n.trim().replace(/\s+/g, " ");
};
var Accounts = class {
  constructor(db, store, data, mailer = new ConsoleMailer(), onMailError = () => void 0) {
    this.db = db;
    this.store = store;
    this.data = data;
    this.mailer = mailer;
    this.onMailError = onMailError;
    this.twoFactor = new TwoFactor(db);
  }
  db;
  store;
  data;
  mailer;
  onMailError;
  /** Email is a courtesy: a failure to send never fails the request (the invite link is also shown in the app). */
  sendMail(msg) {
    void this.mailer.send(msg).catch(this.onMailError);
  }
  get mailKind() {
    return this.mailer.kind;
  }
  // ---- password reset -----------------------------------------------------------
  /** Always behaves the same whether or not the email has an account. */
  async requestPasswordReset(emailRaw, baseUrl) {
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    const user = this.findUserByEmail(email);
    if (!user) return;
    const token = newToken();
    await this.db.query(`delete from password_resets where user_id = $1`, [user.id]);
    await this.db.query(`insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [hashToken(token), user.id]);
    this.sendMail({
      to: user.email,
      subject: "Reset your ABG Tracker password",
      text: `Hi ${user.name},

Use this link within one hour to choose a new password:
${baseUrl}/reset/${token}

If you did not ask for this, you can ignore this email. Your password stays the same.
`
    });
  }
  async resetPassword(token, password) {
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
    const rows = await this.db.query(`select user_id from password_resets where token_hash = $1 and expires_at > now()`, [hashToken(token)]);
    if (!rows.length) throw new HttpError(404, "This reset link is not valid any more. Request a new one.");
    const userId = String(rows[0].user_id);
    await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)
                         on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`, [userId, await hashPassword(password)]);
    await this.db.query(`delete from password_resets where user_id = $1`, [userId]);
    await deleteUserSessions(this.db, userId);
  }
  sendInviteEmail(invite, orgName, inviterName, link) {
    this.sendMail({
      to: invite.email,
      subject: `${inviterName} invited you to ${orgName} on ABG Tracker`,
      text: `${inviterName} invited you to join ${orgName} as ${invite.role}.

Accept the invitation (valid for ${INVITE_DAYS} days):
${link}
`
    });
  }
  orgName(orgId) {
    return this.data.organizations.find((o) => o.id === orgId)?.name ?? "your organization";
  }
  userName(userId) {
    return this.data.users.find((u) => u.id === userId)?.name ?? "Someone";
  }
  findUserByEmail(email) {
    return this.data.users.find((u) => u.email.toLowerCase() === email);
  }
  uniqueSlug(base) {
    let s2 = slugify(base) || "workspace";
    if (s2.length < 2) s2 = `${s2}-team`;
    if (RESERVED_SLUGS.has(s2)) s2 = `${s2}-team`;
    let candidate = s2;
    for (let n = 2; this.data.organizations.some((o) => o.slug === candidate); n++) candidate = `${s2}-${n}`;
    return candidate;
  }
  newUser(name, email) {
    return { id: newId("u"), name, email, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  }
  async register(input, meta) {
    const name = cleanName(input.name, "Your name");
    const email = normEmail(input.email);
    const orgName = cleanName(input.orgName, "Organization name", 2, 80);
    const problem = passwordProblem(input.password);
    if (problem) throw new HttpError(400, problem);
    if (this.findUserByEmail(email)) throw new HttpError(409, "An account with this email already exists.");
    const user = this.newUser(name, email);
    const org2 = { id: newId("org"), name: orgName, slug: this.uniqueSlug(orgName), plan: "free", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    const hash = await hashPassword(input.password);
    await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)`, [user.id, hash]);
    this.data.users.push(user);
    this.data.organizations.push(org2);
    this.data.memberships.push({ id: newId("m"), orgId: org2.id, userId: user.id, role: "owner" });
    try {
      await this.store.flush();
    } catch (e) {
      await this.db.query(`delete from credentials where user_id = $1`, [user.id]);
      await this.store.reload();
      throw e;
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }
  twoFactor;
  /**
   * Returns the user, or null for any failure (same answer for unknown email and wrong password).
   * When the account has two-factor sign-in, a correct password alone is not enough: the answer is
   * `needsCode` until a valid code (or recovery code) comes with it. `codeGate` lets the caller throttle code guesses per account.
   */
  async login(emailRaw, password, code, meta, codeGate = () => true) {
    if (typeof emailRaw !== "string" || typeof password !== "string" || password.length > 200) return null;
    const email = emailRaw.trim().toLowerCase();
    const user = this.findUserByEmail(email);
    const rows = user ? await this.db.query(`select password_hash from credentials where user_id = $1`, [user.id]) : [];
    const ok = await verifyPassword(password, rows.length ? String(rows[0].password_hash) : await getDummyHash());
    if (!user || !rows.length || !ok) return null;
    if (await this.twoFactor.isEnabled(user.id)) {
      if (code === void 0 || code === null || code === "") return { needsCode: true };
      if (!codeGate(user.id)) throw new HttpError(429, "Too many code attempts. Please wait a few minutes.");
      if (!await this.twoFactor.check(user.id, code)) throw new HttpError(401, "That code is not right. Try the newest code, or use a recovery code.");
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }
  /** Signing in through a company identity provider (it has proven who the person is, so there is no password step). */
  async loginSso(user, meta) {
    return { user, token: await createSession(this.db, user.id, meta) };
  }
  /** First sign-in through the identity provider: the person gets an account with no password and a workspace of their own. */
  async registerSso(nameRaw, email, meta) {
    const name = cleanName(nameRaw, "Your name");
    if (this.findUserByEmail(email)) throw new HttpError(409, "An account with this email already exists.");
    const user = this.newUser(name, email);
    const org2 = { id: newId("org"), name: `${name}'s workspace`.slice(0, 80), slug: this.uniqueSlug(`${name} workspace`), plan: "free", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.data.users.push(user);
    this.data.organizations.push(org2);
    this.data.memberships.push({ id: newId("m"), orgId: org2.id, userId: user.id, role: "owner" });
    try {
      await this.store.flush();
    } catch (e) {
      await this.store.reload();
      throw e;
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }
  // ---- profile and two-factor ---------------------------------------------------------
  async updateName(userId, nameRaw) {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, "Account not found.");
    user.name = cleanName(nameRaw, "Your name");
    await this.store.flush();
    return user;
  }
  securityNotice(user, what) {
    this.sendMail({ to: user.email, subject: "Security notice for your ABG Tracker account", text: `Hi ${user.name},

${what}

If this was not you, sign in and change your password now, then turn two-factor sign-in back on.
` });
  }
  async twoFactorStatus(userId) {
    const enabled = await this.twoFactor.isEnabled(userId);
    return { enabled, recoveryLeft: enabled ? await this.twoFactor.recoveryLeft(userId) : 0 };
  }
  /** Step 1: a new secret, as a text key and a ready-to-scan picture. Nothing changes for sign-in yet. */
  async twoFactorBegin(userId) {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, "Account not found.");
    let secret;
    try {
      secret = await this.twoFactor.begin(userId);
    } catch (e) {
      throw new HttpError(409, e.message);
    }
    const uri = otpauthUri(secret, user.email);
    return { secret, uri, qr: await import_qrcode.default.toString(uri, { type: "svg", margin: 1, width: 200 }) };
  }
  /** Step 2: the first code from the phone turns it on; the recovery codes come back once. */
  async twoFactorConfirm(userId, code) {
    const user = this.data.users.find((u) => u.id === userId);
    const codes = user && typeof code === "string" ? await this.twoFactor.confirm(userId, code.replace(/\s/g, "")) : null;
    if (!user || !codes) throw new HttpError(400, "That code is not right. Check the newest code in your app and try again.");
    this.securityNotice(user, "Two-factor sign-in was turned ON for your account.");
    return codes;
  }
  /** Turning it off asks for the password again, so someone at an unlocked screen cannot quietly remove it. */
  async twoFactorDisable(userId, password) {
    const user = this.data.users.find((u) => u.id === userId);
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!user || !rows.length || typeof password !== "string" || !await verifyPassword(password, String(rows[0].password_hash))) throw new HttpError(403, "Your password is not correct.");
    await this.twoFactor.disable(userId);
    this.securityNotice(user, "Two-factor sign-in was turned OFF for your account.");
  }
  async changePassword(userId, current, next, keepToken) {
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem);
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!rows.length || typeof current !== "string" || !await verifyPassword(current, String(rows[0].password_hash))) {
      throw new HttpError(403, "Your current password is not correct.");
    }
    await this.db.query(`update credentials set password_hash = $2, updated_at = now() where user_id = $1`, [userId, await hashPassword(next)]);
    await deleteUserSessions(this.db, userId, keepToken);
  }
  me(userId) {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    const orgIds = new Set(this.data.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    return { user, orgs: this.data.organizations.filter((o) => orgIds.has(o.id)) };
  }
  // ---- invitations ----------------------------------------------------------------
  requireManager(orgId, actorId) {
    const m = this.data.memberships.find((x) => x.orgId === orgId && x.userId === actorId);
    if (!m) throw new HttpError(403, "You are not a member of this organization.");
    if (!can(m.role, "member.manage")) throw new HttpError(403, `Your role (${m.role}) is not allowed to do this.`);
    return m;
  }
  async createInvite(orgId, emailRaw, roleRaw, actorId) {
    const actor = this.requireManager(orgId, actorId);
    const email = normEmail(emailRaw);
    const role = roleRaw;
    if (!["owner", "admin", "member", "guest"].includes(role)) throw new HttpError(400, "Choose a role.");
    if (role === "owner" && actor.role !== "owner") throw new HttpError(403, "Only an owner can invite another owner.");
    const existing = this.findUserByEmail(email);
    if (existing && this.data.memberships.some((m) => m.orgId === orgId && m.userId === existing.id)) {
      throw new HttpError(409, "That person is already in this organization.");
    }
    await this.db.query(`delete from invites where org_id = $1 and lower(email) = $2 and accepted_at is null`, [orgId, email]);
    const token = newToken();
    const id = newId("inv");
    await this.db.query(
      `insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)`,
      [id, orgId, email, role, hashToken(token), actorId, String(INVITE_DAYS)]
    );
    const rows = await this.db.query(`select expires_at from invites where id = $1`, [id]);
    return { token, invite: { id, email, role, invitedBy: actorId, expiresAt: new Date(String(rows[0].expires_at)).toISOString() } };
  }
  async listInvites(orgId, actorId) {
    this.requireManager(orgId, actorId);
    const rows = await this.db.query(`select id, email, role, invited_by, expires_at from invites where org_id = $1 and accepted_at is null and expires_at > now() order by created_at desc`, [orgId]);
    return rows.map((r) => ({ id: String(r.id), email: String(r.email), role: r.role, invitedBy: String(r.invited_by), expiresAt: new Date(String(r.expires_at)).toISOString() }));
  }
  async revokeInvite(orgId, inviteId, actorId) {
    this.requireManager(orgId, actorId);
    await this.db.query(`delete from invites where id = $1 and org_id = $2 and accepted_at is null`, [inviteId, orgId]);
  }
  async findInvite(token) {
    const rows = await this.db.query(`select * from invites where token_hash = $1 and accepted_at is null and expires_at > now()`, [hashToken(token)]);
    return rows[0];
  }
  async getInvite(token) {
    const inv = await this.findInvite(token);
    const org2 = inv && this.data.organizations.find((o) => o.id === inv.org_id);
    if (!inv || !org2) throw new HttpError(404, "This invitation is not valid any more.");
    return { orgName: org2.name, email: String(inv.email), role: inv.role, existingAccount: !!this.findUserByEmail(String(inv.email)) };
  }
  async acceptInvite(token, input, signedInUserId) {
    const inv = await this.findInvite(token);
    const org2 = inv && this.data.organizations.find((o) => o.id === inv.org_id);
    if (!inv || !org2) throw new HttpError(404, "This invitation is not valid any more.");
    const email = String(inv.email);
    let user = this.findUserByEmail(email);
    let sessionToken;
    if (user) {
      if (signedInUserId !== user.id) throw new HttpError(409, `An account for ${email} already exists. Sign in with it, then open this link again.`);
    } else {
      const name = cleanName(input.name, "Your name");
      const problem = passwordProblem(input.password);
      if (problem) throw new HttpError(400, problem);
      user = this.newUser(name, email);
      await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)`, [user.id, await hashPassword(input.password)]);
      this.data.users.push(user);
      sessionToken = await createSession(this.db, user.id);
    }
    if (!this.data.memberships.some((m) => m.orgId === org2.id && m.userId === user.id)) {
      this.data.memberships.push({ id: newId("m"), orgId: org2.id, userId: user.id, role: inv.role });
    }
    await this.store.flush();
    await this.db.query(`update invites set accepted_at = now() where id = $1`, [inv.id]);
    return { user, token: sessionToken, orgSlug: org2.slug };
  }
  // ---- demo data --------------------------------------------------------------------
  /** Loads the sample organizations (only into an empty database). Every demo user gets DEMO_PASSWORD. */
  async seedDemo() {
    if (this.data.users.length > 0) return false;
    const seed = buildSeed();
    Object.assign(this.data, { ...seed, sessionUserId: "" });
    this.store.markAllLoaded();
    await this.store.flush();
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const u of seed.users) await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2) on conflict (user_id) do nothing`, [u.id, hash]);
    return true;
  }
};

// server/app.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);
var import_cookie = __toESM(require("@fastify/cookie"), 1);
var import_static = __toESM(require("@fastify/static"), 1);
var import_fastify = __toESM(require("fastify"), 1);

// server/tickets.ts
var import_node_crypto3 = require("node:crypto");
var UploadTickets = class {
  tickets = /* @__PURE__ */ new Map();
  /** Returns the secret token. Only its hash is kept. */
  create(t2, ttlMs = 15 * 6e4, now2 = Date.now()) {
    this.sweep(now2);
    if (this.tickets.size > 5e3) this.tickets.clear();
    const token = (0, import_node_crypto3.randomBytes)(24).toString("base64url");
    this.tickets.set(this.key(token), { issueId: t2.issueId, actorId: t2.actorId, submitterName: t2.submitterName, remaining: t2.maxFiles, expiresAt: now2 + ttlMs });
    return token;
  }
  /** Spends one upload. Returns the ticket, or null when it is unknown, expired or used up. */
  use(token, now2 = Date.now()) {
    const k = this.key(token);
    const t2 = this.tickets.get(k);
    if (!t2 || t2.expiresAt <= now2 || t2.remaining <= 0) {
      this.tickets.delete(k);
      return null;
    }
    t2.remaining -= 1;
    if (t2.remaining === 0) this.tickets.delete(k);
    return { ...t2 };
  }
  key = (token) => (0, import_node_crypto3.createHash)("sha256").update(token).digest("hex");
  sweep(now2) {
    for (const [k, t2] of this.tickets) if (t2.expiresAt <= now2) this.tickets.delete(k);
  }
};

// server/thumbs.ts
var import_sharp = __toESM(require("sharp"), 1);
var THUMB_SIZE = 360;
var MAX_PIXELS = 5e7;
var Gate = class {
  constructor(max) {
    this.max = max;
  }
  max;
  active = 0;
  waiting = [];
  async run(fn) {
    if (this.active >= this.max) await new Promise((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
};
var gate = new Gate(2);
function makeThumbnail(bytes, size = THUMB_SIZE) {
  return gate.run(
    () => (0, import_sharp.default)(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false }).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  );
}

// server/unsubscribe.ts
var import_node_crypto4 = require("node:crypto");
var Unsubscribe = class {
  constructor(db) {
    this.db = db;
  }
  db;
  secret = null;
  /** Created once and kept in the database, so links stay valid across restarts (and across several servers). */
  getSecret() {
    this.secret ??= (async () => {
      await this.db.query(`insert into app_secrets (name, value) values ('unsubscribe', $1) on conflict (name) do nothing`, [(0, import_node_crypto4.randomBytes)(32).toString("hex")]);
      return String((await this.db.query(`select value from app_secrets where name = 'unsubscribe'`))[0].value);
    })().catch((e) => {
      this.secret = null;
      throw e;
    });
    return this.secret;
  }
  async sign(userId) {
    return (0, import_node_crypto4.createHmac)("sha256", await this.getSecret()).update(`unsubscribe:${userId}`).digest("hex").slice(0, 40);
  }
  async token(userId) {
    return `${userId}.${await this.sign(userId)}`;
  }
  /** The person the token was made for, or null for anything forged, damaged or made by another server. */
  async verify(token) {
    if (typeof token !== "string" || token.length > 200) return null;
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const userId = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const want = Buffer.from(await this.sign(userId));
    return given.length === want.length && (0, import_node_crypto4.timingSafeEqual)(given, want) ? userId : null;
  }
};

// server/db.ts
var import_pglite = require("@electric-sql/pglite");
var import_pg = __toESM(require("pg"), 1);
async function openDb(opts) {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  return openPglite(opts.dataDir);
}
async function openPglite(dataDir) {
  const db = dataDir ? new import_pglite.PGlite(dataDir) : new import_pglite.PGlite();
  await db.waitReady;
  return {
    kind: "pglite",
    async query(sql, params) {
      return (await db.query(sql, params)).rows;
    },
    async tx(fn) {
      return db.transaction(async (t2) => fn(async (sql, params) => (await t2.query(sql, params)).rows));
    },
    close: () => db.close()
  };
}
async function openPostgres(url) {
  const pool = new import_pg.default.Pool({ connectionString: url, max: 10 });
  await pool.query("select 1");
  return {
    kind: "postgres",
    async query(sql, params) {
      return (await pool.query(sql, params)).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(async (sql, params) => (await client.query(sql, params)).rows);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}
var COLLECTIONS = [
  "organizations",
  "users",
  "memberships",
  "projects",
  "sprints",
  "issues",
  "comments",
  "activity",
  "notifications",
  "filters",
  "forms",
  "attachments",
  "rules",
  "runs"
];
async function migrate(db) {
  for (const c of COLLECTIONS) {
    await db.query(`create table if not exists ${c} (
      id text primary key,
      org_id text,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    await db.query(`create index if not exists ${c}_org_idx on ${c} (org_id)`);
  }
  await db.query(`create unique index if not exists users_email_uq on users (lower(data->>'email'))`);
  await db.query(`create unique index if not exists organizations_slug_uq on organizations ((data->>'slug'))`);
  await db.query(`create table if not exists credentials (
    user_id text primary key,
    password_hash text not null,
    updated_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists sessions (
    token_hash text primary key,
    user_id text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await db.query(`create index if not exists sessions_user_idx on sessions (user_id)`);
  await db.query(`create table if not exists invites (
    id text primary key,
    org_id text not null,
    email text not null,
    role text not null,
    token_hash text not null unique,
    invited_by text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    accepted_at timestamptz
  )`);
  await db.query(`create index if not exists invites_org_idx on invites (org_id)`);
  await db.query(`create table if not exists password_resets (
    token_hash text primary key,
    user_id text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await db.query(`create index if not exists password_resets_user_idx on password_resets (user_id)`);
  await db.query(`create table if not exists notification_emails (
    notification_id text primary key,
    outcome text not null,
    handled_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists two_factor (
    user_id text primary key,
    secret_enc text not null,
    enabled boolean not null default false,
    last_step bigint not null default 0,
    created_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists recovery_codes (
    user_id text not null,
    code_hash text not null,
    used_at timestamptz,
    primary key (user_id, code_hash)
  )`);
  await db.query(`alter table sessions add column if not exists user_agent text`);
  await db.query(`alter table sessions add column if not exists ip text`);
  await db.query(`create table if not exists api_tokens (
    id text primary key,
    user_id text not null,
    name text not null,
    scope text not null,
    token_hash text not null unique,
    hint text not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
  )`);
  await db.query(`create index if not exists api_tokens_user_idx on api_tokens (user_id)`);
  await db.query(`create table if not exists webhooks (
    id text primary key,
    org_id text not null,
    url text not null,
    secret text not null,
    format text not null default 'json',
    events text not null,
    active boolean not null default true,
    created_by text not null,
    created_at timestamptz not null default now(),
    last_status text,
    last_at timestamptz
  )`);
  await db.query(`create index if not exists webhooks_org_idx on webhooks (org_id)`);
  await db.query(`create table if not exists mock_invoices (
    id text primary key,
    org_id text not null,
    plan text not null,
    amount_usd integer not null,
    created_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists audit_log (
    id text primary key,
    org_id text not null,
    actor_id text not null,
    action text not null,
    detail text not null default '',
    at timestamptz not null default now()
  )`);
  await db.query(`create index if not exists audit_log_org_idx on audit_log (org_id, at desc)`);
  await db.query(`create table if not exists app_secrets (
    name text primary key,
    value text not null
  )`);
  await db.query(`create table if not exists digest_state (
    user_id text primary key,
    last_sent timestamptz not null
  )`);
}

// server/store.ts
var GLOBAL = ["organizations", "users", "memberships"];
var SCOPED = COLLECTIONS.filter((c) => !GLOBAL.includes(c));
var parse = (v) => typeof v === "string" ? JSON.parse(v) : v;
var PostgresSnapshotStore = class _PostgresSnapshotStore {
  constructor(db) {
    this.db = db;
  }
  db;
  persisted = /* @__PURE__ */ new Map();
  current = null;
  /** org id -> last time it was used (ms) */
  loaded = /* @__PURE__ */ new Map();
  static async open(db) {
    const store = new _PostgresSnapshotStore(db);
    await store.reload();
    return store;
  }
  get loadedOrgCount() {
    return this.loaded.size;
  }
  isLoaded(orgId) {
    return this.loaded.has(orgId);
  }
  async readTable(table, where) {
    const rows = where ? await this.db.query(`select id, data from ${table} where org_id = $1`, [where.orgId]) : await this.db.query(`select id, data from ${table}`);
    const map = /* @__PURE__ */ new Map();
    const recs = rows.map((r) => {
      const rec2 = parse(r.data);
      map.set(String(r.id), JSON.stringify(rec2));
      return rec2;
    });
    return { rows: recs, map };
  }
  /** (Re)reads the shared collections and every organization that is currently loaded. Discards unsaved changes. */
  async reload() {
    const keep = [...this.loaded.keys()];
    const data = {};
    const persisted = /* @__PURE__ */ new Map();
    for (const c of GLOBAL) {
      const { rows, map } = await this.readTable(c);
      data[c] = rows;
      persisted.set(c, map);
    }
    for (const c of SCOPED) {
      data[c] = [];
      persisted.set(c, /* @__PURE__ */ new Map());
    }
    for (const orgId of keep) {
      for (const c of SCOPED) {
        const { rows, map } = await this.readTable(c, { orgId });
        data[c].push(...rows);
        for (const [k, v] of map) persisted.get(c).set(k, v);
      }
    }
    const fresh = { ...data, sessionUserId: "" };
    if (this.current) Object.assign(this.current, fresh);
    else this.current = fresh;
    this.persisted = persisted;
  }
  /** Makes sure an organization's data is in memory. Unknown organizations are ignored. */
  async ensureOrg(orgId) {
    if (this.loaded.has(orgId)) {
      this.loaded.set(orgId, Date.now());
      return;
    }
    const db = this.load();
    if (!db.organizations.some((o) => o.id === orgId)) return;
    const loadedRows = {};
    for (const c of SCOPED) loadedRows[c] = await this.readTable(c, { orgId });
    for (const c of SCOPED) {
      db[c].push(...loadedRows[c].rows);
      const p = this.persisted.get(c);
      for (const [k, v] of loadedRows[c].map) p.set(k, v);
    }
    this.loaded.set(orgId, Date.now());
  }
  /** Which organization owns a record? Used to load the right organization before a call. */
  async orgOf(table, id) {
    if (!SCOPED.includes(table)) throw new Error("Unknown table.");
    const rows = await this.db.query(`select org_id from ${table} where id = $1`, [id]);
    return rows.length && rows[0].org_id ? String(rows[0].org_id) : void 0;
  }
  /**
   * Drops organizations that are idle or beyond the cap (least recently used first), never one
   * in `keep`. Saves first, so nothing is lost.
   */
  async evict(keep, policy, now2 = Date.now()) {
    const candidates = [...this.loaded.entries()].filter(([id]) => !keep.has(id)).sort((a, b) => a[1] - b[1]);
    const doomed = /* @__PURE__ */ new Set();
    for (const [id, last] of candidates) if (now2 - last > policy.idleMs) doomed.add(id);
    let count = this.loaded.size - doomed.size;
    for (const [id] of candidates) {
      if (count <= policy.max) break;
      if (!doomed.has(id)) {
        doomed.add(id);
        count--;
      }
    }
    if (doomed.size === 0) return [];
    await this.flush();
    const db = this.load();
    for (const c of SCOPED) {
      const p = this.persisted.get(c);
      const rows = db[c];
      for (const r of rows) if (r.orgId && doomed.has(r.orgId)) p.delete(r.id);
      db[c] = rows.filter((r) => !(r.orgId && doomed.has(r.orgId)));
    }
    for (const id of doomed) this.loaded.delete(id);
    return [...doomed];
  }
  /** After demo data was inserted straight into memory: every organization present counts as loaded. */
  markAllLoaded() {
    for (const o of this.load().organizations) this.loaded.set(o.id, Date.now());
  }
  /** The repository's synchronous load hook: returns the in-memory data. */
  load() {
    if (!this.current) throw new Error("Store not loaded.");
    return this.current;
  }
  /** The repository calls this after each change; persistence happens in `flush()`. */
  save(db) {
    this.current = db;
  }
  /** Writes changed rows. Call (and await) after each request that may have mutated data. */
  async flush() {
    const db = this.current;
    if (!db) return 0;
    const ops = [];
    const nextPersisted = /* @__PURE__ */ new Map();
    for (const c of COLLECTIONS) {
      const before = this.persisted.get(c) ?? /* @__PURE__ */ new Map();
      const after = /* @__PURE__ */ new Map();
      for (const rec2 of db[c]) {
        const json = JSON.stringify(rec2);
        after.set(rec2.id, json);
        if (before.get(rec2.id) !== json) {
          ops.push({
            sql: `insert into ${c} (id, org_id, data, updated_at) values ($1, $2, $3::jsonb, now())
                  on conflict (id) do update set org_id = excluded.org_id, data = excluded.data, updated_at = now()`,
            params: [rec2.id, rec2.orgId ?? null, json]
          });
        }
      }
      for (const id of before.keys()) {
        if (!after.has(id)) ops.push({ sql: `delete from ${c} where id = $1`, params: [id] });
      }
      nextPersisted.set(c, after);
    }
    if (ops.length === 0) return 0;
    await this.db.tx(async (q) => {
      for (const op of ops) await q(op.sql, op.params);
    });
    this.persisted = nextPersisted;
    return ops.length;
  }
};

// server/dataowner.ts
var csvCell = (v) => {
  let s2 = v === void 0 || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s2)) s2 = `'${s2}`;
  return /[",\r\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2;
};
function issuesCsv(data) {
  const name = (id) => data.members.find((m) => m.id === id)?.email ?? "";
  const rows = [["Key", "Project", "Type", "Status", "Priority", "Title", "Assignee", "Reporter", "Labels", "Estimate", "Start", "Due", "Created", "Description"]];
  for (const i of data.issues) {
    const p = data.projects.find((x) => x.id === i.projectId);
    rows.push([i.key, p?.name, p?.issueTypes.find((t2) => t2.id === i.typeId)?.name, p?.statuses.find((s2) => s2.id === i.statusId)?.name, i.priority, i.title, name(i.assigneeId), name(i.reporterId), i.labels.join("; "), i.estimate, i.startDate, i.dueDate, i.createdAt, i.description]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
var DataOwner = class {
  constructor(db, store, data, twoFactor) {
    this.db = db;
    this.store = store;
    this.data = data;
    this.twoFactor = twoFactor;
  }
  db;
  store;
  data;
  twoFactor;
  role(orgId, userId) {
    return this.data.memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;
  }
  requireOwner(orgId, userId) {
    const r = this.role(orgId, userId);
    if (!r) throw new HttpError(403, "You are not a member of this organization.");
    if (r !== "owner") throw new HttpError(403, "Only an owner can do this.");
  }
  async confirmIdentity(userId, password, code) {
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!rows.length || typeof password !== "string" || !await verifyPassword(password, String(rows[0].password_hash))) throw new HttpError(403, "Your password is not correct.");
    if (await this.twoFactor.isEnabled(userId)) {
      if (!await this.twoFactor.check(userId, code)) throw new HttpError(403, "Enter a valid 6-digit code from your authenticator app.");
    }
  }
  // ---- audit log ----------------------------------------------------------------------------
  async audit(orgId, actorId, action, detail = "") {
    await this.db.query(`insert into audit_log (id, org_id, actor_id, action, detail) values ($1, $2, $3, $4, $5)`, [
      `au_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      orgId,
      actorId,
      action.slice(0, 60),
      detail.slice(0, 300)
    ]);
  }
  async listAudit(orgId, userId) {
    const role = this.role(orgId, userId);
    if (!role) throw new HttpError(403, "You are not a member of this organization.");
    if (role !== "owner" && role !== "admin") throw new HttpError(403, "Only owners and admins can see the audit log.");
    const rows = await this.db.query(`select id, actor_id, action, detail, at from audit_log where org_id = $1 order by at desc, id desc limit 200`, [orgId]);
    return rows.map((r) => ({
      id: String(r.id),
      at: new Date(String(r.at)).toISOString(),
      actor: this.data.users.find((u) => u.id === r.actor_id)?.name ?? "Someone",
      action: String(r.action),
      detail: String(r.detail ?? "")
    }));
  }
  // ---- delete an organization -------------------------------------------------------------
  /** Owner only; needs the password (and the code, if two-factor is on) and the organization's exact name. Everything in it goes. */
  async deleteOrganization(orgId, userId, password, confirmName, code) {
    this.requireOwner(orgId, userId);
    const org2 = this.data.organizations.find((o) => o.id === orgId);
    if (typeof confirmName !== "string" || confirmName.trim() !== org2.name) throw new HttpError(400, `Type the organization's name exactly (${org2.name}) to confirm.`);
    await this.confirmIdentity(userId, password, code);
    this.data.organizations = this.data.organizations.filter((o) => o.id !== orgId);
    this.data.memberships = this.data.memberships.filter((m) => m.orgId !== orgId);
    for (const c of SCOPED) this.data[c] = this.data[c].filter((r) => r.orgId !== orgId);
    await this.store.flush();
    await this.db.query(`delete from invites where org_id = $1`, [orgId]);
    await this.db.query(`delete from audit_log where org_id = $1`, [orgId]);
  }
  // ---- delete an account ------------------------------------------------------------------
  /** Orgs this person is the only owner of: they must hand over or delete those first. */
  soleOwnerOf(userId) {
    return this.data.memberships.filter((m) => m.userId === userId && m.role === "owner" && !this.data.memberships.some((o) => o.orgId === m.orgId && o.role === "owner" && o.userId !== userId)).map((m) => this.data.organizations.find((o) => o.id === m.orgId)?.name ?? m.orgId);
  }
  /**
   * Erases the person. Their login, devices, two-factor and settings are deleted; their name and address on
   * old comments and history become "Deleted user" (so other people's records stay readable); their open work is unassigned.
   * The caller must have loaded every organization the person belongs to.
   */
  async deleteAccount(userId, password, code) {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, "Account not found.");
    const sole = this.soleOwnerOf(userId);
    if (sole.length) throw new HttpError(409, `You are the only owner of ${sole.join(", ")}. Make someone else an owner, or delete the organization, before deleting your account.`);
    await this.confirmIdentity(userId, password, code);
    const email = user.email;
    for (const i of this.data.issues) if (i.assigneeId === userId) i.assigneeId = void 0;
    this.data.notifications = this.data.notifications.filter((n) => n.userId !== userId);
    this.data.filters = this.data.filters.filter((f) => f.ownerId !== userId);
    this.data.memberships = this.data.memberships.filter((m) => m.userId !== userId);
    user.name = "Deleted user";
    user.email = `deleted+${user.id}@deleted.invalid`;
    user.color = "#9ca3af";
    delete user.notify;
    await this.store.flush();
    for (const t2 of ["credentials", "sessions", "two_factor", "recovery_codes", "digest_state", "password_resets"]) await this.db.query(`delete from ${t2} where user_id = $1`, [userId]);
    await this.db.query(`delete from invites where lower(email) = $1`, [email.toLowerCase()]);
  }
};

// server/csvimport.ts
var MAX_IMPORT_ROWS = 500;
var MAX_IMPORT_BYTES = 2 * 1024 * 1024;
function parseCsv(text2) {
  const src = text2.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
var norm = (s2) => s2.trim().toLowerCase();
var HEADER_ALIASES = {
  title: "title",
  summary: "title",
  name: "title",
  "issue summary": "title",
  description: "description",
  details: "description",
  type: "type",
  "issue type": "type",
  priority: "priority",
  status: "status",
  assignee: "assignee",
  "assigned to": "assignee",
  labels: "labels",
  label: "labels",
  tags: "labels",
  estimate: "estimate",
  points: "estimate",
  "story points": "estimate",
  start: "start",
  "start date": "start",
  due: "due",
  "due date": "due"
};
var isDate = (s2) => /^\d{4}-\d{2}-\d{2}$/.test(s2) && !Number.isNaN(Date.parse(s2));
function planImport(text2, project, memberIds) {
  const rows = parseCsv(text2);
  if (rows.length < 2) throw new Error("The file needs a header row (Title, Description, Priority, \u2026) and at least one item.");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} items at a time (this file has ${rows.length - 1}).`);
  const cols = rows[0].map((h) => HEADER_ALIASES[norm(h)]);
  if (!cols.includes("title")) throw new Error('The first row must have a "Title" column.');
  const workType = project.issueTypes.find((t2) => t2.level === 1) ?? project.issueTypes[0];
  const items = [];
  const skipped = [];
  rows.slice(1).forEach((cells, idx) => {
    const row = idx + 2;
    const get = (k) => (cells[cols.indexOf(k)] ?? "").trim();
    const title = get("title");
    if (!title) return void skipped.push({ row, reason: "No title." });
    if (title.length > 300) return void skipped.push({ row, reason: "Title is longer than 300 characters." });
    const priority = ["critical", "high", "medium", "low"].find((p) => p === norm(get("priority")));
    const person = norm(get("assignee"));
    const assignee = person ? memberIds.find((m) => m.email.toLowerCase() === person || m.name.toLowerCase() === person) : void 0;
    const estimate = get("estimate") === "" ? void 0 : Number(get("estimate"));
    const start = get("start");
    const due = get("due");
    if (estimate !== void 0 && (!Number.isFinite(estimate) || estimate < 0)) return void skipped.push({ row, reason: "Estimate must be a number." });
    if (start && !isDate(start) || due && !isDate(due)) return void skipped.push({ row, reason: "Dates must look like 2026-12-31." });
    items.push({
      row,
      input: {
        projectId: project.id,
        typeId: project.issueTypes.find((t2) => norm(t2.name) === norm(get("type")))?.id ?? workType.id,
        title,
        description: get("description").slice(0, 2e4),
        statusId: project.statuses.find((s2) => norm(s2.name) === norm(get("status")))?.id,
        priority,
        assigneeId: assignee?.id,
        labels: get("labels") ? get("labels").split(/[;,]/).map((l) => l.trim()).filter(Boolean).slice(0, 20) : [],
        estimate,
        startDate: start || void 0,
        dueDate: due || void 0
      }
    });
  });
  return { items, skipped };
}

// server/apitokens.ts
var import_node_crypto5 = require("node:crypto");
var TOKEN_PREFIX = "abg_";
var MAX_TOKENS = 20;
var ApiTokens = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(userId, nameRaw, scopeRaw) {
    const name = typeof nameRaw === "string" ? nameRaw.trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 60) throw new HttpError(400, 'Give the token a name (up to 60 characters), such as "Reporting script".');
    if (scopeRaw !== "read" && scopeRaw !== "write" && scopeRaw !== "calendar") throw new HttpError(400, "Choose what the token may do.");
    const count = Number((await this.db.query(`select count(*) as n from api_tokens where user_id = $1`, [userId]))[0].n);
    if (count >= MAX_TOKENS) throw new HttpError(400, `You have ${MAX_TOKENS} tokens already. Remove one you no longer use.`);
    const token = TOKEN_PREFIX + (0, import_node_crypto5.randomBytes)(24).toString("base64url");
    const id = newId("tok");
    await this.db.query(`insert into api_tokens (id, user_id, name, scope, token_hash, hint) values ($1, $2, $3, $4, $5, $6)`, [id, userId, name, scopeRaw, hashToken(token), token.slice(0, 8)]);
    return { token, view: { id, name, scope: scopeRaw, hint: token.slice(0, 8), createdAt: (/* @__PURE__ */ new Date()).toISOString(), lastUsedAt: null } };
  }
  async list(userId) {
    const rows = await this.db.query(`select id, name, scope, hint, created_at, last_used_at from api_tokens where user_id = $1 order by created_at desc`, [userId]);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      scope: r.scope,
      hint: String(r.hint),
      createdAt: new Date(String(r.created_at)).toISOString(),
      lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null
    }));
  }
  async revoke(userId, id) {
    return (await this.db.query(`delete from api_tokens where id = $1 and user_id = $2 returning id`, [id, userId])).length > 0;
  }
  async revokeAll(userId) {
    await this.db.query(`delete from api_tokens where user_id = $1`, [userId]);
  }
  /** Who the token belongs to and what it may do, or null. Remembers when it was last used (at most every few minutes). */
  async verify(token) {
    if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
    const rows = await this.db.query(`select id, user_id, scope, last_used_at from api_tokens where token_hash = $1`, [hashToken(token)]);
    if (!rows.length) return null;
    const r = rows[0];
    if (!r.last_used_at || Date.now() - new Date(String(r.last_used_at)).getTime() > 5 * 6e4) {
      await this.db.query(`update api_tokens set last_used_at = now() where id = $1`, [r.id]);
    }
    return { userId: String(r.user_id), scope: r.scope, id: String(r.id) };
  }
};

// server/live.ts
var MAX_PER_USER = 5;
var KEEPALIVE_MS = 25e3;
var LiveBus = class {
  constructor(isMember) {
    this.isMember = isMember;
  }
  isMember;
  conns = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  get count() {
    let n = 0;
    for (const s2 of this.conns.values()) n += s2.size;
    return n;
  }
  /** Registers an open stream. The oldest stream of a person is closed when they have too many (many tabs). */
  add(userId, res) {
    const set = this.conns.get(userId) ?? /* @__PURE__ */ new Set();
    while (set.size >= MAX_PER_USER) {
      const oldest = set.values().next().value;
      this.drop(userId, oldest);
    }
    set.add(res);
    this.conns.set(userId, set);
    this.timers.set(res, setInterval(() => this.write(res, ": keepalive\n\n"), KEEPALIVE_MS).unref());
    res.on("close", () => this.drop(userId, res));
  }
  write(res, text2) {
    try {
      res.write(text2);
    } catch {
    }
  }
  drop(userId, res) {
    clearInterval(this.timers.get(res));
    this.timers.delete(res);
    this.conns.get(userId)?.delete(res);
    if (!this.conns.get(userId)?.size) this.conns.delete(userId);
    try {
      res.end();
    } catch {
    }
  }
  /** Says "this organization changed" to everyone who belongs to it and is connected. */
  publish(orgIds) {
    for (const orgId of new Set(orgIds)) {
      for (const [userId, set] of this.conns) {
        if (!this.isMember(userId, orgId)) continue;
        for (const res of set) this.write(res, `event: changed
data: ${JSON.stringify({ orgId })}

`);
      }
    }
  }
  closeAll() {
    for (const [userId, set] of [...this.conns]) for (const res of [...set]) this.drop(userId, res);
  }
};

// server/serviceroutes.ts
var import_node_crypto7 = require("node:crypto");

// server/services.ts
var import_node_crypto6 = require("node:crypto");
var NO_SERVICES = { billing: "none", sso: "none", ai: "none" };
var PLANS = {
  free: { label: "Free", priceUsdPerMonth: 0, people: 10, projects: 5 },
  team: { label: "Team", priceUsdPerMonth: 49, people: 50, projects: 50 },
  business: { label: "Business", priceUsdPerMonth: 199, people: 1e3, projects: 1e3 }
};
var isPlan = (p) => p === "free" || p === "team" || p === "business";
var MockBillingProvider = class {
  constructor(db) {
    this.db = db;
  }
  db;
  kind = "mock";
  async changePlan(org2, plan) {
    if (plan !== "free") {
      await this.db.query(`insert into mock_invoices (id, org_id, plan, amount_usd) values ($1, $2, $3, $4)`, [newId("inv"), org2.id, plan, PLANS[plan].priceUsdPerMonth]);
    }
    return { done: true };
  }
  async invoices(orgId) {
    return (await this.db.query(`select id, plan, amount_usd, created_at from mock_invoices where org_id = $1 order by created_at desc limit 24`, [orgId])).map((r) => ({
      id: String(r.id),
      plan: r.plan,
      amountUsd: Number(r.amount_usd),
      at: new Date(String(r.created_at)).toISOString(),
      mock: true
    }));
  }
};
var MockSsoProvider = class {
  constructor(secret) {
    this.secret = secret;
  }
  secret;
  id = "mock";
  label = "Sign in with Mock SSO (demo)";
  kind = "mock";
  sign(payload) {
    return (0, import_node_crypto6.createHmac)("sha256", this.secret).update(payload).digest("base64url");
  }
  /** The mock provider's own page lives in this server, and issues a signed one-time-style code. */
  authorizeUrl(state, redirectUri) {
    return `/api/sso/mock/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  issueCode(identity) {
    const payload = Buffer.from(JSON.stringify({ ...identity, exp: Date.now() + 2 * 6e4 })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  async exchange(code) {
    const [payload, sig] = String(code).split(".");
    if (!payload || !sig || sig.length !== this.sign(payload).length || !(0, import_node_crypto6.timingSafeEqual)(Buffer.from(sig), Buffer.from(this.sign(payload)))) throw new HttpError(400, "The sign-in could not be verified.");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!(data.exp > Date.now())) throw new HttpError(400, "The sign-in took too long. Please try again.");
    return { email: data.email, name: data.name, emailVerified: data.emailVerified };
  }
};
var newState = () => (0, import_node_crypto6.randomBytes)(24).toString("base64url");
var plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
var MockAiProvider = class {
  kind = "mock";
  label = "Mock AI (no real model connected)";
  /** Rules, not a model: late work first, then what is due soon and urgent. Same shape a real model must return. */
  async brief(input) {
    const { counts: c } = input;
    const weight = { critical: 30, high: 15, medium: 5, low: 0 };
    const score = (i) => {
      const d = i.dueInDays;
      const base = d === null ? 0 : d < 0 ? 100 + Math.min(-d, 30) : d === 0 ? 80 : d <= 2 ? 60 : d <= 7 ? 30 : 5;
      return base + (weight[i.priority] ?? 0) - (i.blocked ? 25 : 0);
    };
    const why = (i) => {
      const bits = [];
      const d = i.dueInDays;
      if (d !== null) bits.push(d < 0 ? `${plural(-d, "day")} overdue` : d === 0 ? "due today" : `due in ${plural(d, "day")}`);
      if (i.priority === "critical" || i.priority === "high") bits.push(`${i.priority} priority`);
      return (bits.join(", ") || "next in line").replace(/^./, (x) => x.toUpperCase());
    };
    const ranked = [...input.items].filter((i) => !i.blocked || i.dueInDays !== null).sort((a, b) => score(b) - score(a)).slice(0, 3);
    const summary = c.open === 0 ? `Hi ${input.firstName}. You have nothing open right now, so this is a good moment to look at what the team needs.` : `Hi ${input.firstName}. You have ${plural(c.open, "open item")}${c.overdue ? `, ${c.overdue} of them overdue` : ""}${c.dueThisWeek ? `, and ${c.dueThisWeek} due in the next 7 days` : ""}.${c.overdue === 0 && c.dueThisWeek === 0 ? " Nothing is pressing." : ""}`;
    const watchouts = [];
    if (c.awaitingMyApproval) watchouts.push(`${plural(c.awaitingMyApproval, "item")} ${c.awaitingMyApproval === 1 ? "is" : "are"} waiting for your approval${input.approvals[0] ? `, starting with ${input.approvals[0].key}` : ""}.`);
    const blocked = input.items.filter((i) => i.blocked);
    if (blocked.length) watchouts.push(`${blocked.slice(0, 2).map((i) => i.key).join(" and ")}${blocked.length > 2 ? ` and ${blocked.length - 2} more` : ""} ${blocked.length === 1 ? "is" : "are"} blocked by other work.`);
    const urgent = input.items.filter((i) => i.priority === "critical").length;
    if (urgent) watchouts.push(`${plural(urgent, "critical item")} ${urgent === 1 ? "is" : "are"} still open.`);
    if (c.overdue > 0 && c.doneThisWeek === 0) watchouts.push("Nothing has been finished this week yet.");
    return { summary, focus: ranked.map((i) => ({ key: i.key, why: why(i) })), watchouts: watchouts.slice(0, 4) };
  }
  async summarize(input) {
    const clip = (s2, n) => s2.replace(/\s+/g, " ").trim().length > n ? `${s2.replace(/\s+/g, " ").trim().slice(0, n - 1)}\u2026` : s2.replace(/\s+/g, " ").trim();
    const people = [...new Set(input.comments.map((c) => c.author))];
    const lines = [`\u201C${clip(input.title, 120)}\u201D`];
    if (input.description.trim()) lines.push(`What it is: ${clip(input.description, 240)}`);
    if (input.comments.length) {
      lines.push(`${input.comments.length} comment${input.comments.length === 1 ? "" : "s"} from ${people.slice(0, 4).join(", ")}${people.length > 4 ? ` and ${people.length - 4} more` : ""}.`);
      const last = input.comments[input.comments.length - 1];
      lines.push(`Latest (${last.author}): ${clip(last.body, 200)}`);
    } else lines.push("No comments yet.");
    return lines.join("\n");
  }
};

// server/serviceroutes.ts
var SSO_COOKIE = "abg_sso_state";
var esc = (s2) => s2.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
async function usageOf(db, store, orgId) {
  const people = store.load().memberships.filter((m) => m.orgId === orgId).length;
  const pending = Number((await db.query(`select count(*) as n from invites where org_id = $1 and accepted_at is null and expires_at > now()`, [orgId]))[0].n);
  const projects = Number((await db.query(`select count(*) as n from projects where org_id = $1`, [orgId]))[0].n);
  return { people, pendingInvites: pending, projects };
}
function registerServices(d) {
  const { app, db, store } = d;
  const billing = d.billingProvider ?? (d.services.billing === "mock" ? new MockBillingProvider(db) : null);
  const sso = d.services.sso === "mock" ? new MockSsoProvider(d.mockSecret) : null;
  const ai = d.aiProvider ?? (d.services.ai === "mock" ? new MockAiProvider() : null);
  const briefLimiter = new RateLimiter(10, 6e4);
  const limiter = new RateLimiter(30, 6e4);
  const aiLimiter = new RateLimiter(20, 6e4);
  const planOf = (orgId) => store.load().organizations.find((o) => o.id === orgId)?.plan ?? "free";
  const role = (orgId, userId) => store.load().memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;
  const describe = () => ({
    sso: sso ? { id: sso.id, label: sso.label, mock: sso.kind === "mock" } : null,
    billing: billing ? { mock: billing.kind === "mock" } : null,
    ai: ai ? { label: ai.label, mock: ai.kind === "mock" } : null
  });
  const assertSeat = async (orgId) => {
    const u = await usageOf(db, store, orgId);
    const plan = planOf(orgId);
    if (u.people + u.pendingInvites >= PLANS[plan].people) throw new HttpError(402, `Your ${PLANS[plan].label} plan includes ${PLANS[plan].people} people (including pending invitations). Upgrade to add more.`);
  };
  const assertProjectRoom = async (orgId) => {
    const u = await usageOf(db, store, orgId);
    const plan = planOf(orgId);
    if (u.projects >= PLANS[plan].projects) throw new HttpError(402, `Your ${PLANS[plan].label} plan includes ${PLANS[plan].projects} projects. Upgrade to create more.`);
  };
  app.get("/api/orgs/:orgId/billing", async (req) => {
    const userId = d.requireUser(req);
    const r = role(req.params.orgId, userId);
    if (!r) throw new HttpError(403, "You are not a member of this organization.");
    if (r !== "owner" && r !== "admin") throw new HttpError(403, "Only owners and admins can see billing.");
    return {
      mode: billing ? billing.kind : "none",
      plan: planOf(req.params.orgId),
      plans: PLANS,
      usage: await usageOf(db, store, req.params.orgId),
      invoices: billing ? await billing.invoices(req.params.orgId) : [],
      canChange: !!billing && r === "owner"
    };
  });
  app.post("/api/orgs/:orgId/billing/plan", async (req) => {
    const userId = d.requireUser(req);
    if (!limiter.allow(userId)) throw new HttpError(429, "Too many changes. Try again in a minute.");
    if (role(req.params.orgId, userId) !== "owner") throw new HttpError(403, "Only an owner can change the plan.");
    if (!billing) throw new HttpError(400, "Plan changes are not available on this server yet. Contact your administrator.");
    const plan = req.body?.plan;
    if (!isPlan(plan)) throw new HttpError(400, "Choose a plan.");
    const org2 = store.load().organizations.find((o) => o.id === req.params.orgId);
    if (org2.plan === plan) throw new HttpError(409, `You are already on the ${PLANS[plan].label} plan.`);
    const u = await usageOf(db, store, org2.id);
    const lim = PLANS[plan];
    if (u.people > lim.people || u.projects > lim.projects) {
      throw new HttpError(409, `The ${lim.label} plan includes ${lim.people} people and ${lim.projects} projects, and you have ${u.people} people and ${u.projects} projects. Remove some first.`);
    }
    const outcome = await billing.changePlan(org2, plan, userId);
    if ("redirectTo" in outcome) return { redirectTo: outcome.redirectTo };
    const from = org2.plan;
    await d.transact(true, async () => {
      store.load().organizations.find((o) => o.id === org2.id).plan = plan;
    });
    await d.audit(org2.id, userId, "billing.plan", `${PLANS[from].label} \u2192 ${PLANS[plan].label}${billing.kind === "mock" ? " (mock billing, no real charge)" : ""}`).catch(() => void 0);
    return { ok: true, plan };
  });
  const callbackUrl = `${d.publicUrl}/api/auth/sso/callback`;
  const fail = (reply, code) => reply.clearCookie(SSO_COOKIE, { path: "/" }).redirect(`/?sso_error=${code}`);
  app.get("/api/auth/sso/start", async (req, reply) => {
    if (!sso) throw new HttpError(404, "Single sign-on is not set up on this server.");
    const state = newState();
    reply.setCookie(SSO_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: d.secureCookies, path: "/", maxAge: 600 });
    return reply.redirect(sso.authorizeUrl(state, callbackUrl));
  });
  if (sso && sso.kind === "mock") {
    const mock = sso;
    app.get("/api/sso/mock/authorize", async (req, reply) => {
      if (req.query.redirect_uri !== callbackUrl || !req.query.state) throw new HttpError(400, "Bad request.");
      return reply.header("content-type", "text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock identity provider</title>
<body style="font-family:system-ui;max-width:26rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Mock identity provider</h1>
<p style="color:#555">For demos only: there is no real company login here. Choose who you are pretending to be.</p>
<form method="get" action="/api/sso/mock/approve" style="display:grid;gap:.75rem">
<input type="hidden" name="state" value="${esc(req.query.state)}">
<label>Email <input name="email" type="email" required style="width:100%;padding:.4rem"></label>
<label>Name <input name="name" required style="width:100%;padding:.4rem"></label>
<label><input type="checkbox" name="verified" value="1" checked> The provider has verified this email address</label>
<button style="padding:.5rem">Continue</button></form>`);
    });
    app.get("/api/sso/mock/approve", async (req, reply) => {
      const { state, email, name, verified } = req.query;
      if (!state || !email || !name) throw new HttpError(400, "Bad request.");
      const code = mock.issueCode({ email: email.trim().toLowerCase(), name: name.trim().slice(0, 100), emailVerified: verified === "1" });
      return reply.redirect(`${callbackUrl}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    });
  }
  app.get("/api/auth/sso/callback", async (req, reply) => {
    if (!sso) throw new HttpError(404, "Single sign-on is not set up on this server.");
    const cookie2 = req.cookies[SSO_COOKIE];
    const state = req.query.state ?? "";
    if (!cookie2 || cookie2.length !== state.length || !(0, import_node_crypto7.timingSafeEqual)(Buffer.from(cookie2), Buffer.from(state))) return fail(reply, "state");
    let identity;
    try {
      identity = await sso.exchange(String(req.query.code ?? ""), callbackUrl);
    } catch {
      return fail(reply, "verify");
    }
    if (!identity.emailVerified) return fail(reply, "unverified");
    const email = identity.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(reply, "verify");
    const meta = { userAgent: String(req.headers["user-agent"] ?? ""), ip: d.ip(req) };
    const existing = d.accounts.findUserByEmail(email);
    if (!existing && !d.allowSignup) return fail(reply, "closed");
    const out = await d.transact(true, () => existing ? d.accounts.loginSso(existing, meta) : d.accounts.registerSso(identity.name, email, meta));
    reply.clearCookie(SSO_COOKIE, { path: "/" });
    d.setSession(reply, out.token);
    return reply.redirect("/");
  });
  app.post("/api/orgs/:slug/issues/:key/summary", async (req) => {
    const userId = d.requireUser(req);
    if (!ai) throw new HttpError(404, "The AI assistant is not set up on this server.");
    if (!aiLimiter.allow(userId)) throw new HttpError(429, "Slow down a little: try again in a minute.");
    const org2 = store.load().organizations.find((o) => o.slug === req.params.slug);
    if (!org2) throw new HttpError(404, "Organization not found.");
    return d.transact(false, async () => {
      const data = await d.repo.loadOrg(org2.id, userId);
      const issue = data.issues.find((i) => i.key.toLowerCase() === req.params.key.toLowerCase());
      if (!issue) throw new HttpError(404, "Item not found.");
      const comments = data.comments.filter((c) => c.issueId === issue.id).slice(-30).map((c) => ({ author: data.members.find((m) => m.id === c.authorId)?.name ?? "Someone", body: c.body.slice(0, 2e3) }));
      const summary = await ai.summarize({ title: issue.title, description: issue.description.slice(0, 6e3), comments });
      return { summary, provider: ai.label, mock: ai.kind === "mock" };
    }, async () => [org2.id]);
  });
  app.post("/api/orgs/:slug/briefing", async (req) => {
    const userId = d.requireUser(req);
    if (!ai) throw new HttpError(404, "The AI assistant is not set up on this server.");
    if (!briefLimiter.allow(userId)) throw new HttpError(429, "Slow down a little: try again in a minute.");
    const org2 = store.load().organizations.find((o) => o.slug === req.params.slug);
    if (!org2) throw new HttpError(404, "Organization not found.");
    const me = store.load().users.find((u) => u.id === userId);
    const today = localDate(/* @__PURE__ */ new Date(), resolvePrefs(me).timeZone);
    return d.transact(false, async () => {
      const data = await d.repo.loadOrg(org2.id, userId);
      const stats = computeDashboard(data, userId, /* @__PURE__ */ new Date(`${today}T12:00:00`));
      const days = (due) => due ? Math.round((Date.parse(due) - Date.parse(today)) / 864e5) : null;
      const blockedIds = new Set(stats.tiles.blocked.map((r) => r.issue.id));
      const items = stats.mine.slice(0, 15).map((r) => ({
        key: r.issue.key,
        title: r.issue.title.slice(0, 120),
        status: statusOf(r.project, r.issue.statusId)?.name ?? "",
        priority: r.issue.priority,
        dueInDays: days(r.issue.dueDate),
        blocked: blockedIds.has(r.issue.id)
      }));
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const doneThisWeek = data.issues.filter((i) => i.assigneeId === userId && i.resolvedAt && i.resolvedAt >= weekAgo && isDone(data.projects.find((p) => p.id === i.projectId), i)).length;
      const input = {
        firstName: (me?.name ?? "there").split(" ")[0].slice(0, 40),
        counts: {
          open: stats.kpis.myOpen,
          overdue: stats.kpis.myOverdue,
          blocked: stats.mine.filter((r) => blockedIds.has(r.issue.id)).length,
          dueThisWeek: stats.dueSoon.filter((r) => (r.issue.dueDate ?? "") >= today).length,
          awaitingMyApproval: stats.approvals.length,
          doneThisWeek
        },
        items,
        approvals: stats.approvals.slice(0, 5).map((r) => ({ key: r.issue.key, title: r.issue.title.slice(0, 120) }))
      };
      let out;
      try {
        out = await ai.brief(input);
      } catch {
        throw new HttpError(502, "The assistant could not answer right now. Try again in a moment.");
      }
      const known = new Map(items.map((i) => [i.key, i]));
      const seen = /* @__PURE__ */ new Set();
      const focus = (Array.isArray(out.focus) ? out.focus : []).filter((f) => f && typeof f.key === "string" && known.has(f.key) && !seen.has(f.key) && seen.add(f.key)).slice(0, 5).map((f) => ({ key: f.key, title: known.get(f.key).title, why: String(f.why ?? "").slice(0, 120) }));
      return {
        summary: String(out.summary ?? "").slice(0, 600),
        focus,
        watchouts: (Array.isArray(out.watchouts) ? out.watchouts : []).slice(0, 4).map((w) => String(w).slice(0, 200)),
        provider: ai.label,
        mock: ai.kind === "mock",
        at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }, async () => [org2.id]);
  });
  return { describe, assertSeat, assertProjectRoom };
}

// server/app.ts
var import_node_crypto9 = require("node:crypto");

// server/firebaseAdmin.ts
var import_app = require("firebase-admin/app");
var import_auth6 = require("firebase-admin/auth");
var adminApp = null;
function initFirebaseAdmin() {
  if (adminApp) return true;
  const rawId = process.env.FIREBASE_PROJECT_ID;
  const projectId = rawId && !rawId.startsWith("G-") ? rawId : process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "abgtracker-a9a6a";
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  try {
    const existingApps = (0, import_app.getApps)();
    if (existingApps.length === 0) {
      if (emulatorHost) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
        adminApp = (0, import_app.initializeApp)({ projectId });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        adminApp = (0, import_app.initializeApp)({
          credential: (0, import_app.applicationDefault)(),
          projectId
        });
      } else if (projectId) {
        adminApp = (0, import_app.initializeApp)({ projectId });
      }
    } else {
      adminApp = existingApps[0];
    }
  } catch {
    adminApp = null;
  }
  return !!adminApp;
}
async function verifyFirebaseIdToken(idToken) {
  if (!initFirebaseAdmin() || !adminApp) {
    return null;
  }
  try {
    const auth = (0, import_auth6.getAuth)(adminApp);
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken, true);
    } catch {
      decoded = await auth.verifyIdToken(idToken, false);
    }
    return {
      uid: decoded.uid,
      email: decoded.email ? decoded.email.trim().toLowerCase() : null,
      name: decoded.name ?? null,
      emailVerified: !!decoded.email_verified
    };
  } catch {
    return null;
  }
}

// server/webhooks.ts
var import_node_crypto8 = require("node:crypto");
var import_promises = require("node:dns/promises");
var import_node_net = require("node:net");
var WEBHOOK_EVENTS = ["issue.created", "issue.updated", "issue.deleted", "comment.created"];
var MAX_HOOKS = 10;
function isPrivateAddress(addr) {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7));
  if ((0, import_node_net.isIP)(a) === 4) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || p === 100 && q >= 64 && q <= 127 || p === 169 && q === 254 || p === 172 && q >= 16 && q <= 31 || p === 192 && q === 168 || p === 192 && q === 0 || p === 198 && (q === 18 || q === 19) || p >= 224;
  }
  if ((0, import_node_net.isIP)(a) === 6) return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff");
  return true;
}
var defaultResolver = async (host) => (await (0, import_promises.lookup)(host, { all: true })).map((r) => r.address);
async function assertSafeUrl(raw, opts = {}) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new HttpError(400, "Enter a full web address, such as https://example.com/hook.");
  }
  if (u.protocol !== "https:" && !(opts.allowInsecure && u.protocol === "http:")) throw new HttpError(400, "The address must start with https://.");
  if (u.username || u.password) throw new HttpError(400, "Do not put a user name or password in the address.");
  if (String(raw).length > 500) throw new HttpError(400, "That address is too long.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new HttpError(400, "That address points inside your network, which is not allowed.");
  let addrs;
  try {
    addrs = (0, import_node_net.isIP)(host) ? [host] : await (opts.resolve ?? defaultResolver)(host);
  } catch {
    throw new HttpError(400, "That address could not be found.");
  }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new HttpError(400, "That address points inside a private network, which is not allowed.");
  return u;
}
var signPayload = (secret, timestamp, body) => `sha256=${(0, import_node_crypto8.createHmac)("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
var Webhooks = class {
  constructor(deps) {
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.delays = deps.retryDelays ?? [1e3, 5e3];
  }
  deps;
  fetchImpl;
  delays;
  /** Resolves when everything started so far has finished: lets tests wait without sleeping. */
  inflight = /* @__PURE__ */ new Set();
  async idle() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }
  view(r) {
    return {
      id: String(r.id),
      url: String(r.url),
      format: r.format,
      events: String(r.events).split(",").filter(Boolean),
      active: r.active === true,
      lastStatus: r.last_status ? String(r.last_status) : null,
      lastAt: r.last_at ? new Date(String(r.last_at)).toISOString() : null
    };
  }
  async list(orgId) {
    return (await this.deps.db.query(`select * from webhooks where org_id = $1 order by created_at`, [orgId])).map((r) => this.view(r));
  }
  /** The secret is returned here once, and never again. */
  async create(orgId, userId, input) {
    const u = await assertSafeUrl(input.url, this.deps);
    const events = Array.isArray(input.events) ? WEBHOOK_EVENTS.filter((e) => input.events.includes(e)) : [];
    if (!events.length) throw new HttpError(400, "Choose at least one thing to be told about.");
    const format = input.format === "slack" ? "slack" : "json";
    const count = Number((await this.deps.db.query(`select count(*) as n from webhooks where org_id = $1`, [orgId]))[0].n);
    if (count >= MAX_HOOKS) throw new HttpError(400, `An organization can have ${MAX_HOOKS} webhooks. Remove one first.`);
    const id = newId("wh");
    const secret = `whsec_${(0, import_node_crypto8.randomBytes)(24).toString("base64url")}`;
    await this.deps.db.query(`insert into webhooks (id, org_id, url, secret, format, events, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [id, orgId, u.toString(), secret, format, events.join(","), userId]);
    return { hook: { id, url: u.toString(), format, events, active: true, lastStatus: null, lastAt: null }, secret };
  }
  async setActive(orgId, id, active) {
    return (await this.deps.db.query(`update webhooks set active = $3 where id = $1 and org_id = $2 returning id`, [id, orgId, active])).length > 0;
  }
  async remove(orgId, id) {
    return (await this.deps.db.query(`delete from webhooks where id = $1 and org_id = $2 returning id`, [id, orgId])).length > 0;
  }
  async removeAllFor(orgId) {
    await this.deps.db.query(`delete from webhooks where org_id = $1`, [orgId]);
  }
  /** Starts deliveries and returns immediately. */
  emit(orgId, orgSlug, event, data) {
    const job = (async () => {
      const hooks = await this.deps.db.query(`select * from webhooks where org_id = $1 and active = true`, [orgId]);
      for (const h of hooks) if (String(h.events).split(",").includes(event)) await this.deliver(h, event, orgSlug, data);
    })().catch((e) => this.deps.log?.(`webhook error: ${e instanceof Error ? e.message : e}`)).finally(() => void this.inflight.delete(job));
    this.inflight.add(job);
  }
  /** Sends a harmless "ping" so a person can check their receiving end. Reports the outcome. */
  async ping(orgId, orgSlug, id) {
    const rows = await this.deps.db.query(`select * from webhooks where id = $1 and org_id = $2`, [id, orgId]);
    if (!rows.length) throw new HttpError(404, "Webhook not found.");
    return this.deliver(rows[0], "ping", orgSlug, { message: "This is a test from ABG Tracker." });
  }
  text(event, data) {
    if (event === "ping") return "ABG Tracker: test message.";
    const key = String(data.key ?? "");
    const title = String(data.title ?? "");
    const verb = event === "issue.created" ? "created" : event === "issue.deleted" ? "deleted" : event === "comment.created" ? "commented on" : "updated";
    return `${key} ${verb}: ${title}${data.url ? ` (${data.url})` : ""}`.replace(/[\r\n]+/g, " ").slice(0, 500);
  }
  async deliver(h, event, orgSlug, data) {
    const body = JSON.stringify(
      h.format === "slack" ? { text: this.text(event, data) } : { event, at: (/* @__PURE__ */ new Date()).toISOString(), organization: orgSlug, data }
    );
    let outcome = "";
    for (let attempt = 0; attempt <= this.delays.length; attempt++) {
      try {
        const url = await assertSafeUrl(h.url, this.deps);
        const ts = String(Math.floor(Date.now() / 1e3));
        const res = await this.fetchImpl(url, {
          method: "POST",
          redirect: "manual",
          // a redirect could lead somewhere private
          signal: AbortSignal.timeout(5e3),
          headers: { "content-type": "application/json", "user-agent": "ABG-Tracker-Webhook", "x-abg-event": event, "x-abg-timestamp": ts, "x-abg-signature": signPayload(String(h.secret), ts, body) },
          body
        });
        outcome = res.ok ? `OK (${res.status})` : `Failed (${res.status})`;
        if (res.ok || res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (e) {
        outcome = e instanceof HttpError ? `Blocked: ${e.message}` : "Failed (no answer)";
        if (e instanceof HttpError) break;
      }
      if (attempt < this.delays.length) await new Promise((r) => setTimeout(r, this.delays[attempt]));
    }
    await this.deps.db.query(`update webhooks set last_status = $2, last_at = now() where id = $1`, [h.id, outcome]).catch(() => void 0);
    return outcome;
  }
};

// server/publicapi.ts
function issueView(issue, project, users, baseUrl, slug2) {
  const person = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? { name: u.name, email: u.email } : null;
  };
  const status = project.statuses.find((s2) => s2.id === issue.statusId);
  return {
    key: issue.key,
    title: issue.title,
    description: issue.description,
    type: project.issueTypes.find((t2) => t2.id === issue.typeId)?.name ?? null,
    status: status?.name ?? null,
    statusCategory: status?.category ?? null,
    priority: issue.priority,
    assignee: person(issue.assigneeId),
    reporter: person(issue.reporterId),
    labels: issue.labels,
    estimate: issue.estimate ?? null,
    start: issue.startDate ?? null,
    due: issue.dueDate ?? null,
    created: issue.createdAt,
    updated: issue.updatedAt,
    url: `${baseUrl}/${encodeURIComponent(slug2)}/p/${encodeURIComponent(project.key)}/board?issue=${encodeURIComponent(issue.key)}`
  };
}
var isDate2 = (s2) => typeof s2 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s2) && !Number.isNaN(Date.parse(s2));
var text = (v, max, what) => {
  if (typeof v !== "string") throw new HttpError(400, `${what} must be text.`);
  if (v.length > max) throw new HttpError(400, `${what} is too long (up to ${max} characters).`);
  return v;
};
function mapFields(body, project, users) {
  const out = {};
  if (body.title !== void 0) {
    out.title = text(body.title, 300, "title").trim();
    if (!out.title) throw new HttpError(400, "title is required.");
  }
  if (body.description !== void 0) out.description = text(body.description, 2e4, "description");
  if (body.priority !== void 0) {
    if (!["critical", "high", "medium", "low"].includes(String(body.priority))) throw new HttpError(400, "priority must be critical, high, medium or low.");
    out.priority = body.priority;
  }
  if (body.status !== void 0) {
    const s2 = project.statuses.find((x) => x.name.toLowerCase() === String(body.status).toLowerCase());
    if (!s2) throw new HttpError(400, `Unknown status. Use one of: ${project.statuses.map((x) => x.name).join(", ")}.`);
    out.statusId = s2.id;
  }
  if (body.type !== void 0) {
    const t2 = project.issueTypes.find((x) => x.name.toLowerCase() === String(body.type).toLowerCase());
    if (!t2) throw new HttpError(400, `Unknown type. Use one of: ${project.issueTypes.map((x) => x.name).join(", ")}.`);
    out.typeId = t2.id;
  }
  if (body.assignee !== void 0) {
    if (body.assignee === null || body.assignee === "") out.assigneeId = null;
    else {
      const u = users.find((x) => x.email.toLowerCase() === String(body.assignee).toLowerCase());
      if (!u) throw new HttpError(400, "assignee must be the email of someone in this organization.");
      out.assigneeId = u.id;
    }
  }
  for (const [k, field] of [["due", "dueDate"], ["start", "startDate"]]) {
    if (body[k] === void 0) continue;
    if (body[k] === null || body[k] === "") out[field] = void 0;
    else if (isDate2(body[k])) out[field] = body[k];
    else throw new HttpError(400, `${k} must look like 2026-12-31.`);
  }
  if (body.labels !== void 0) {
    if (!Array.isArray(body.labels) || body.labels.length > 20 || body.labels.some((l) => typeof l !== "string" || l.length > 40)) throw new HttpError(400, "labels must be a list of up to 20 short texts.");
    out.labels = body.labels;
  }
  if (body.estimate !== void 0) {
    if (body.estimate === null) out.estimate = void 0;
    else if (typeof body.estimate === "number" && Number.isFinite(body.estimate) && body.estimate >= 0) out.estimate = body.estimate;
    else throw new HttpError(400, "estimate must be a number.");
  }
  return out;
}
function makeEmitter(d) {
  const view = (issue) => {
    const org2 = d.store.load().organizations.find((o) => o.id === issue.orgId);
    const project = d.repo.snapshot.projects.find((p) => p.id === issue.projectId);
    return org2 && project ? { org: org2, data: issueView(issue, project, d.store.load().users, d.baseUrl, org2.slug) } : null;
  };
  return {
    issue(event, issue) {
      try {
        const v = view(issue);
        if (v) d.webhooks.emit(issue.orgId, v.org.slug, event, v.data);
      } catch {
      }
    },
    comment(issue, comment) {
      try {
        const v = view(issue);
        if (v) d.webhooks.emit(issue.orgId, v.org.slug, "comment.created", { ...v.data, comment: { body: comment.body.slice(0, 1e3), author: d.store.load().users.find((u) => u.id === comment.authorId)?.name ?? null } });
      } catch {
      }
    }
  };
}
function registerPublicApi(d) {
  const { app, store, repo, transact } = d;
  const limiter = new RateLimiter(120, 6e4);
  const emitter = makeEmitter(d);
  const user = (req) => {
    if (!req.userId || !req.tokenId) throw new HttpError(401, 'Send your token as "Authorization: Bearer abg_\u2026".');
    if (!limiter.allow(req.tokenId)) throw new HttpError(429, "Too many requests. Slow down (120 a minute).");
    return req.userId;
  };
  const needWrite = (req) => {
    if (req.tokenScope !== "write") throw new HttpError(403, "This token is read-only. Create a token that can write.");
  };
  const orgBySlug = (slug2) => {
    const org2 = store.load().organizations.find((o) => o.slug === slug2);
    if (!org2) throw new HttpError(404, "Organization not found.");
    return org2;
  };
  const withProject = async (slug2, key, userId) => {
    const org2 = orgBySlug(slug2);
    const data = await repo.loadOrg(org2.id, userId);
    const project = data.projects.find((p) => p.key.toLowerCase() === key.toLowerCase());
    if (!project) throw new HttpError(404, "Project not found.");
    return { org: org2, data, project };
  };
  const findIssue = async (slug2, key, userId) => {
    const org2 = orgBySlug(slug2);
    const data = await repo.loadOrg(org2.id, userId);
    const issue = data.issues.find((i) => i.key.toLowerCase() === key.toLowerCase());
    const project = issue && data.projects.find((p) => p.id === issue.projectId);
    if (!issue || !project) throw new HttpError(404, "Item not found.");
    return { org: org2, data, issue, project };
  };
  const scope = (slug2) => async () => {
    const o = store.load().organizations.find((x) => x.slug === slug2);
    return o ? [o.id] : [];
  };
  const v = (issue, project, members, slug2) => issueView(issue, project, members, d.baseUrl, slug2);
  app.get("/api/v1/me", async (req) => {
    const u = store.load().users.find((x) => x.id === user(req));
    return { name: u?.name, email: u?.email, tokenScope: req.tokenScope };
  });
  app.get("/api/v1/orgs", async (req) => {
    const id = user(req);
    const ids = new Set(store.load().memberships.filter((m) => m.userId === id).map((m) => m.orgId));
    return { orgs: store.load().organizations.filter((o) => ids.has(o.id)).map((o) => ({ slug: o.slug, name: o.name })) };
  });
  app.get("/api/v1/orgs/:slug/projects", async (req) => {
    const id = user(req);
    return transact(false, async () => {
      const org2 = orgBySlug(req.params.slug);
      const data = await repo.loadOrg(org2.id, id);
      return { projects: data.projects.map((p) => ({ key: p.key, name: p.name, statuses: p.statuses.map((s2) => ({ name: s2.name, category: s2.category })), types: p.issueTypes.map((t2) => t2.name) })) };
    }, scope(req.params.slug));
  });
  app.get("/api/v1/orgs/:slug/projects/:key/issues", async (req) => {
    const id = user(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    return transact(false, async () => {
      const { data, project } = await withProject(req.params.slug, req.params.key, id);
      const q = (req.query.q ?? "").toLowerCase();
      let list = data.issues.filter((i) => i.projectId === project.id);
      if (req.query.status) list = list.filter((i) => project.statuses.find((s2) => s2.id === i.statusId)?.name.toLowerCase() === req.query.status.toLowerCase());
      if (req.query.assignee) list = list.filter((i) => data.members.find((m) => m.id === i.assigneeId)?.email.toLowerCase() === req.query.assignee.toLowerCase());
      if (q) list = list.filter((i) => i.title.toLowerCase().includes(q));
      list.sort((a, b) => a.number - b.number);
      return { total: list.length, issues: list.slice(offset, offset + limit).map((i) => v(i, project, data.members, req.params.slug)) };
    }, scope(req.params.slug));
  });
  app.get("/api/v1/orgs/:slug/issues/:key", async (req) => {
    const id = user(req);
    return transact(false, async () => {
      const { data, issue, project } = await findIssue(req.params.slug, req.params.key, id);
      const comments = data.comments.filter((c) => c.issueId === issue.id).map((c) => ({ author: data.members.find((m) => m.id === c.authorId)?.name ?? null, body: c.body, created: c.createdAt }));
      return { issue: v(issue, project, data.members, req.params.slug), comments };
    }, scope(req.params.slug));
  });
  app.post("/api/v1/orgs/:slug/projects/:key/issues", async (req, reply) => {
    const id = user(req);
    needWrite(req);
    const body = req.body ?? {};
    const created = await transact(true, async () => {
      const { org: org2, data, project } = await withProject(req.params.slug, req.params.key, id);
      if (typeof body.title !== "string" || !body.title.trim()) throw new HttpError(400, "title is required.");
      const f = mapFields(body, project, data.members);
      const typeId = f.typeId ?? (project.issueTypes.find((t2) => t2.level === 1) ?? project.issueTypes[0]).id;
      const input = { ...f, projectId: project.id, typeId, title: f.title, assigneeId: f.assigneeId ?? void 0 };
      const issue = await repo.createIssue(org2.id, input, id);
      return { issue, project, members: data.members };
    }, scope(req.params.slug));
    emitter.issue("issue.created", created.issue);
    return reply.code(201).send({ issue: v(created.issue, created.project, created.members, req.params.slug) });
  });
  app.patch("/api/v1/orgs/:slug/issues/:key", async (req) => {
    const id = user(req);
    needWrite(req);
    const body = req.body ?? {};
    const out = await transact(true, async () => {
      const { data, issue, project } = await findIssue(req.params.slug, req.params.key, id);
      const f = mapFields(body, project, data.members);
      if (!Object.keys(f).length) throw new HttpError(400, "Nothing to change. Send any of: title, description, status, priority, assignee, due, start, labels, estimate.");
      const { assigneeId, ...rest } = f;
      const patch = { ...rest, ...assigneeId !== void 0 ? { assigneeId: assigneeId ?? void 0 } : {} };
      return { issue: await repo.updateIssue(issue.id, patch, id), project, members: data.members };
    }, scope(req.params.slug));
    emitter.issue("issue.updated", out.issue);
    return { issue: v(out.issue, out.project, out.members, req.params.slug) };
  });
  app.post("/api/v1/orgs/:slug/issues/:key/comments", async (req, reply) => {
    const id = user(req);
    needWrite(req);
    const body = req.body ?? {};
    const text5 = text(body.body, 1e4, "body").trim();
    if (!text5) throw new HttpError(400, "body is required.");
    const out = await transact(true, async () => {
      const { issue } = await findIssue(req.params.slug, req.params.key, id);
      return { issue, comment: await repo.addComment(issue.id, text5, id) };
    }, scope(req.params.slug));
    emitter.comment(out.issue, out.comment);
    return reply.code(201).send({ comment: { body: out.comment.body, created: out.comment.createdAt } });
  });
}
var icsText = (s2) => s2.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
var fold = (line) => {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
};
var compact = (d) => d.replace(/-/g, "");
var dayAfter = (d) => compact(new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10));
function dueDatesIcs(items) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ABG Tracker//Due dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:ABG Tracker: my due dates"];
  for (const { issue, project, orgName, url } of items) {
    if (!issue.dueDate || isDone(project, issue)) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${issue.id}@abg-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(issue.dueDate)}`,
      `DTEND;VALUE=DATE:${dayAfter(issue.dueDate)}`,
      `SUMMARY:${icsText(`${issue.key} ${issue.title}`)}`,
      `DESCRIPTION:${icsText(`${orgName} \xB7 ${project.name}`)}`,
      `URL:${url}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// server/app.ts
var COOKIE = "abg_session";
var CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
var CSRF_HEADER = "x-requested-with";
var CSRF_VALUE = "abg-tracker";
var org = (arg = 0) => ({ kind: "org", arg });
var rec = (table, arg = 0) => ({ kind: "record", table, arg });
var RPC = {
  listOrganizations: { n: 0, mutates: false },
  loadOrg: { n: 1, mutates: false, scope: org() },
  createProject: { n: 2, mutates: true, scope: org() },
  updateProject: { n: 2, mutates: true, scope: rec("projects") },
  deleteStatus: { n: 3, mutates: true, scope: rec("projects") },
  deleteIssueType: { n: 3, mutates: true, scope: rec("projects") },
  deleteAttachment: { n: 1, mutates: true, scope: rec("attachments") },
  markNotificationRead: { n: 1, mutates: true, scope: rec("notifications") },
  markAllNotificationsRead: { n: 1, mutates: true, scope: org() },
  setNotifyPrefs: { n: 1, mutates: true },
  setDashboardLayout: { n: 1, mutates: true },
  saveFilter: { n: 2, mutates: true, scope: org() },
  deleteFilter: { n: 1, mutates: true, scope: rec("filters") },
  createIssue: { n: 2, mutates: true, scope: org() },
  updateIssue: { n: 2, mutates: true, scope: rec("issues") },
  deleteIssue: { n: 1, mutates: true, scope: rec("issues") },
  addComment: { n: 2, mutates: true, scope: rec("issues") },
  setWatching: { n: 2, mutates: true, scope: rec("issues") },
  toggleReaction: { n: 2, mutates: true, scope: rec("comments") },
  createSprint: { n: 2, mutates: true, scope: rec("projects") },
  updateSprint: { n: 2, mutates: true, scope: rec("sprints") },
  startSprint: { n: 1, mutates: true, scope: rec("sprints") },
  completeSprint: { n: 2, mutates: true, scope: rec("sprints") },
  deleteSprint: { n: 1, mutates: true, scope: rec("sprints") },
  createForm: { n: 2, mutates: true, scope: rec("projects") },
  updateForm: { n: 2, mutates: true, scope: rec("forms") },
  deleteForm: { n: 1, mutates: true, scope: rec("forms") },
  createRule: { n: 2, mutates: true, scope: rec("projects") },
  updateRule: { n: 2, mutates: true, scope: rec("rules") },
  deleteRule: { n: 1, mutates: true, scope: rec("rules") },
  runScheduledAutomations: { n: 1, mutates: true, scope: org() },
  decideApproval: { n: 3, mutates: true, scope: rec("issues") },
  resetApproval: { n: 1, mutates: true, scope: rec("issues") },
  updateMemberRole: { n: 3, mutates: true, scope: org() },
  removeMember: { n: 2, mutates: true, scope: org() },
  getPublicForm: { n: 2, mutates: false, public: true, scope: { kind: "slug", arg: 0 } },
  submitForm: { n: 5, mutates: true, public: true, scope: { kind: "slug", arg: 0 } }
};
function statusFor(e) {
  if (/not a member|not allowed|only an owner|only the owner|only admins/i.test(e.message)) return 403;
  if (/not found|not available/i.test(e.message)) return 404;
  return 400;
}
async function buildApp(deps) {
  const { db, store, repo, accounts, config, files } = deps;
  const limits = deps.attachmentLimits ?? DEFAULT_LIMITS;
  const blocked = deps.blockedExtensions ?? BLOCKED_EXTENSIONS;
  const publicLimits = { ...limits, maxFileBytes: Math.min(limits.maxFileBytes, deps.publicMaxFileBytes ?? 10 * 1024 * 1024) };
  const tickets = new UploadTickets();
  const tokens = new ApiTokens(db);
  const webhooks = deps.webhooks ?? new Webhooks({ db, log: (l) => console.error(l) });
  const app = (0, import_fastify.default)({ logger: config.logger ? { level: "info", redact: ["req.headers.cookie"] } : false, bodyLimit: 1e6, trustProxy: config.trustProxy === true });
  await app.register(import_cookie.default);
  let chain = Promise.resolve();
  const locked = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => void 0);
    return run;
  };
  const live = new LiveBus((userId, orgId) => store.load().memberships.some((m) => m.userId === userId && m.orgId === orgId));
  app.addHook("onClose", async () => live.closeAll());
  const cachePolicy = config.orgCache ?? { max: 50, idleMs: 30 * 6e4 };
  const transact = (mutates, fn, orgs = async () => []) => locked(async () => {
    let needed = [];
    try {
      needed = await orgs();
      for (const id of needed) await store.ensureOrg(id);
      const out = await fn();
      if (mutates) {
        await store.flush();
        live.publish(needed);
        const gone = repo.drainFileDeletions();
        if (files && gone.length) {
          const results = await Promise.allSettled(gone.map((g) => files.remove(g.orgId, g.storageKey)));
          for (const r of results) if (r.status === "rejected") app.log.error({ err: r.reason }, "could not delete a stored file");
        }
      }
      return out;
    } catch (e) {
      if (mutates) {
        await store.reload().catch(() => void 0);
        repo.drainFileDeletions();
      }
      throw e;
    } finally {
      await store.evict(new Set(needed), cachePolicy).catch((err) => app.log.error({ err }, "eviction failed"));
    }
  });
  const orgsFor = async (scope, args) => {
    const v = scope ? args[scope.arg] : void 0;
    if (!scope || typeof v !== "string") return [];
    if (scope.kind === "org") return [v];
    if (scope.kind === "slug") return store.load().organizations.filter((o) => o.slug === v).map((o) => o.id);
    const owner2 = await store.orgOf(scope.table, v);
    return owner2 ? [owner2] : [];
  };
  const loginLimiter = new RateLimiter(8, 10 * 6e4);
  const loginIpLimiter = new RateLimiter(40, 10 * 6e4);
  const publicLimiter = new RateLimiter(60, 6e4);
  const registerLimiter = new RateLimiter(10, 60 * 6e4);
  const forgotIpLimiter = new RateLimiter(10, 60 * 6e4);
  const forgotEmailLimiter = new RateLimiter(3, 60 * 6e4);
  const codeLimiter = new RateLimiter(10, 10 * 6e4);
  const twoFactorLimiter = new RateLimiter(10, 10 * 6e4);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    if (config.secureCookies) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (!req.url.startsWith("/api/")) {
      reply.header("content-security-policy", CSP);
      return;
    }
    reply.header("cache-control", "no-store");
    if (req.url.startsWith("/api/v1/")) {
      const auth = req.headers.authorization;
      const t2 = typeof auth === "string" && /^Bearer /i.test(auth) ? await tokens.verify(auth.slice(7).trim()) : null;
      if (!t2 || t2.scope === "calendar") throw new HttpError(401, 'Send a personal token as "Authorization: Bearer abg_\u2026".');
      req.userId = t2.userId;
      req.tokenScope = t2.scope;
      req.tokenId = t2.id;
      req.sessionToken = void 0;
      return;
    }
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && /^Bearer /i.test(authHeader)) {
      const fbToken = authHeader.slice(7).trim();
      const identity = await verifyFirebaseIdToken(fbToken);
      if (!identity || !identity.email) {
        throw new HttpError(401, "Invalid or expired authorization token.");
      }
      let u = accounts.findUserByEmail(identity.email);
      if (!u && config.allowSignup !== false) {
        const out = await transact(
          true,
          () => accounts.registerSso(identity.name || identity.email.split("@")[0], identity.email, {
            userAgent: String(req.headers["user-agent"] ?? ""),
            ip: ip(req)
          })
        );
        u = out.user;
      }
      if (!u) {
        throw new HttpError(403, "Account is not authorized.");
      }
      req.userId = u.id;
      req.sessionToken = void 0;
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== CSRF_VALUE && !req.url.startsWith("/api/unsubscribe/")) {
      throw new HttpError(403, "Missing request header.");
    }
    req.sessionToken = req.cookies[COOKIE];
    req.userId = await sessionUser(db, req.sessionToken);
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.statusCode === 413 ? "Request too large." : "Invalid request." });
    if (err instanceof DomainError) return reply.code(statusFor(err)).send({ error: err.message });
    if (err instanceof TypeError || err instanceof RangeError) return reply.code(400).send({ error: "Invalid request." });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "Something went wrong on our side." });
  });
  const requireUser = (req) => {
    if (!req.userId) throw new HttpError(401, "Please sign in.");
    return req.userId;
  };
  const setSession = (reply, token) => reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/", maxAge: SESSION_DAYS * 86400 });
  const baseUrl = (req) => typeof req.headers.origin === "string" && /^https?:\/\//.test(req.headers.origin) ? req.headers.origin : config.publicUrl;
  const ip = (req) => req.ip;
  app.get("/api/events", async (req, reply) => {
    const userId = requireUser(req);
    reply.hijack();
    reply.raw.writeHead(200, { ...reply.getHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write("retry: 3000\n\n");
    live.add(userId, reply.raw);
  });
  app.get("/api/health", async () => ({ ok: true, database: db.kind, loadedOrganizations: store.loadedOrgCount }));
  app.get("/api/config", async () => ({
    allowSignup: config.allowSignup !== false,
    emailEnabled: accounts.mailKind === "smtp",
    ...svc.describe(),
    attachments: files ? { enabled: true, publicMaxFileBytes: publicLimits.maxFileBytes, maxFileBytes: limits.maxFileBytes, maxFilesPerIssue: limits.maxFilesPerIssue, blockedExtensions: blocked } : { enabled: false }
  }));
  app.post("/api/auth/register", async (req, reply) => {
    if (config.allowSignup === false) throw new HttpError(403, "Creating new workspaces is closed. Ask an administrator for an invitation.");
    if (!registerLimiter.allow(ip(req))) throw new HttpError(429, "Too many sign-ups from this address. Try again later.");
    const body = req.body ?? {};
    const out = await transact(true, () => accounts.register(body, { userAgent: String(req.headers["user-agent"] ?? ""), ip: ip(req) }));
    setSession(reply, out.token);
    return { user: out.user, ...accounts.me(out.user.id) };
  });
  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body ?? {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const key = `${ip(req)}|${email}`;
    if (!loginIpLimiter.allow(ip(req)) || !loginLimiter.allow(key)) throw new HttpError(429, "Too many sign-in attempts. Please wait a few minutes.");
    const out = await locked(() => accounts.login(body.email, body.password, body.code, { userAgent: String(req.headers["user-agent"] ?? ""), ip: ip(req) }, (uid2) => codeLimiter.allow(uid2)));
    if (!out) throw new HttpError(401, "Incorrect email or password.");
    if ("needsCode" in out) return { twoFactorRequired: true };
    loginLimiter.reset(key);
    codeLimiter.reset(out.user.id);
    setSession(reply, out.token);
    return accounts.me(out.user.id);
  });
  app.post("/api/auth/firebase-session", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.idToken !== "string" || !body.idToken.trim()) {
      throw new HttpError(400, "Missing idToken.");
    }
    const identity = await verifyFirebaseIdToken(body.idToken.trim());
    if (!identity || !identity.email) {
      throw new HttpError(401, "Invalid or expired Firebase ID token.");
    }
    const email = identity.email.toLowerCase();
    const meta = { userAgent: String(req.headers["user-agent"] ?? ""), ip: ip(req) };
    const existing = accounts.findUserByEmail(email);
    if (!existing && config.allowSignup === false) {
      throw new HttpError(403, "Creating new workspaces is closed. Ask an administrator for an invitation.");
    }
    const out = await transact(
      true,
      () => existing ? accounts.loginSso(existing, meta) : accounts.registerSso(identity.name || email.split("@")[0], email, meta)
    );
    setSession(reply, out.token);
    return accounts.me(out.user.id);
  });
  app.post("/api/me/profile", async (req) => {
    const userId = requireUser(req);
    const body = req.body ?? {};
    const user = await transact(true, () => accounts.updateName(userId, body.name));
    return { user };
  });
  app.get("/api/me/sessions", async (req) => ({ sessions: await listSessions(db, requireUser(req), req.sessionToken) }));
  app.delete("/api/me/sessions/:id", async (req) => {
    const ok = await revokeSession(db, requireUser(req), req.params.id, req.sessionToken);
    if (!ok) throw new HttpError(404, "That device is not signed in any more.");
    return { ok: true };
  });
  app.post("/api/me/sessions/sign-out-others", async (req) => {
    await deleteUserSessions(db, requireUser(req), req.sessionToken);
    return { ok: true };
  });
  app.get("/api/me/2fa", async (req) => accounts.twoFactorStatus(requireUser(req)));
  app.post("/api/me/2fa/begin", async (req) => {
    const userId = requireUser(req);
    if (!twoFactorLimiter.allow(userId)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
    return locked(() => accounts.twoFactorBegin(userId));
  });
  app.post("/api/me/2fa/confirm", async (req) => {
    const userId = requireUser(req);
    if (!codeLimiter.allow(userId)) throw new HttpError(429, "Too many code attempts. Please wait a few minutes.");
    const body = req.body ?? {};
    const recoveryCodes = await locked(() => accounts.twoFactorConfirm(userId, body.code));
    return { recoveryCodes };
  });
  app.post("/api/me/2fa/disable", async (req) => {
    const userId = requireUser(req);
    if (!twoFactorLimiter.allow(userId)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
    const body = req.body ?? {};
    await locked(() => accounts.twoFactorDisable(userId, body.password));
    return { ok: true };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    await deleteSession(db, req.sessionToken);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/me", async (req) => {
    const me = req.userId ? accounts.me(req.userId) : null;
    if (!me) throw new HttpError(401, "Please sign in.");
    return me;
  });
  app.post("/api/auth/forgot", async (req) => {
    const body = req.body ?? {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!forgotIpLimiter.allow(ip(req)) || !forgotEmailLimiter.allow(email)) return { ok: true };
    await locked(() => accounts.requestPasswordReset(email, baseUrl(req)));
    return { ok: true };
  });
  app.post("/api/auth/reset/:token", async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests.");
    const body = req.body ?? {};
    await locked(() => accounts.resetPassword(req.params.token, body.password));
    return { ok: true };
  });
  app.post("/api/auth/password", async (req) => {
    const userId = requireUser(req);
    const body = req.body ?? {};
    await locked(() => accounts.changePassword(userId, body.current, body.next, req.sessionToken));
    return { ok: true };
  });
  const unsubscribe = deps.unsubscribe ?? new Unsubscribe(db);
  const testMailLimiter = new RateLimiter(3, 60 * 6e4);
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 }, (_req, _body, done) => done(null, {}));
  app.get("/api/unsubscribe/:token", async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests.");
    const userId = await unsubscribe.verify(req.params.token);
    const user = userId ? store.load().users.find((u) => u.id === userId) : void 0;
    if (!user) throw new HttpError(404, "This link is not valid.");
    return { name: user.name };
  });
  app.post("/api/unsubscribe/:token", async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests.");
    const userId = await unsubscribe.verify(req.params.token);
    if (!userId) throw new HttpError(404, "This link is not valid.");
    await transact(true, async () => {
      const user = store.load().users.find((u) => u.id === userId);
      if (!user) throw new HttpError(404, "This link is not valid.");
      await repo.setNotifyPrefs({ ...resolvePrefs(user), email: "off" }, userId);
    });
    return { ok: true };
  });
  app.post("/api/me/test-email", async (req) => {
    const userId = requireUser(req);
    if (!testMailLimiter.allow(userId)) throw new HttpError(429, "You have sent a few test emails already. Try again in an hour.");
    const user = store.load().users.find((u) => u.id === userId);
    if (!user) throw new HttpError(401, "Please sign in.");
    if (!deps.mailer || deps.mailer.kind !== "smtp") return { sent: false, reason: "Email is not set up on this server yet. An administrator needs to set SMTP_URL." };
    try {
      await deps.mailer.send({ to: user.email, subject: "ABG Tracker test email", text: `Hi ${user.name},

This is a test. If you can read it, notification emails from ABG Tracker can reach you.
` });
      return { sent: true };
    } catch (err) {
      app.log.error({ err }, "test email failed");
      return { sent: false, reason: "The mail server did not accept the message. An administrator should check the SMTP settings and the server log." };
    }
  });
  app.post("/api/orgs/:orgId/invites", async (req) => {
    const userId = requireUser(req);
    const body = req.body ?? {};
    await svc.assertSeat(req.params.orgId);
    const { token, invite } = await locked(() => accounts.createInvite(req.params.orgId, body.email, body.role, userId));
    await owner.audit(req.params.orgId, userId, "invite.create", ` as ${invite.role}`).catch(() => void 0);
    const link = `${baseUrl(req)}/invite/${token}`;
    accounts.sendInviteEmail(invite, accounts.orgName(req.params.orgId), accounts.userName(userId), link);
    return { invite, link, emailed: accounts.mailKind === "smtp" };
  });
  app.get("/api/orgs/:orgId/invites", async (req) => ({ invites: await locked(() => accounts.listInvites(req.params.orgId, requireUser(req))) }));
  app.delete("/api/orgs/:orgId/invites/:id", async (req) => {
    const userId = requireUser(req);
    await locked(() => accounts.revokeInvite(req.params.orgId, req.params.id, userId));
    await owner.audit(req.params.orgId, userId, "invite.revoke").catch(() => void 0);
    return { ok: true };
  });
  app.get("/api/invites/:token", async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests.");
    return locked(() => accounts.getInvite(req.params.token));
  });
  app.post("/api/invites/:token/accept", async (req, reply) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests.");
    const body = req.body ?? {};
    const out = await transact(true, () => accounts.acceptInvite(req.params.token, body, req.userId));
    if (out.token) setSession(reply, out.token);
    const joined = store.load().organizations.find((o) => o.slug === out.orgSlug);
    if (joined) await owner.audit(joined.id, out.user.id, "member.join", out.user.name).catch(() => void 0);
    return { orgSlug: out.orgSlug };
  });
  app.post("/api/rpc/:method", async (req) => {
    const spec = Object.prototype.hasOwnProperty.call(RPC, req.params.method) ? RPC[req.params.method] : void 0;
    if (!spec) throw new HttpError(404, "Unknown method.");
    const body = req.body ?? {};
    if (!Array.isArray(body.args) || body.args.length > spec.n) throw new HttpError(400, "Invalid request.");
    const args = Array.from({ length: spec.n }, (_, i) => body.args[i]);
    if (spec.public) {
      if (!publicLimiter.allow(ip(req))) throw new HttpError(429, "Too many requests. Please slow down.");
      const call = repo[req.params.method];
      const result2 = await transact(
        spec.mutates,
        async () => {
          const out = await call.apply(repo, args);
          if (req.params.method === "submitForm" && files && out && typeof out.key === "string") {
            const org2 = store.load().organizations.find((o) => o.slug === args[0]);
            const form = org2 && repo.snapshot.forms.find((f) => f.orgId === org2.id && f.slug === args[1]);
            const issue = org2 && repo.snapshot.issues.find((i) => i.orgId === org2.id && i.key === out.key);
            if (form && issue && form.fields.some((f) => f.kind === "file")) {
              const who = String(args[3]?.name ?? "").trim().slice(0, 100) || "Request form sender";
              out.upload = {
                token: tickets.create({ issueId: issue.id, actorId: form.createdBy, submitterName: who, maxFiles: PUBLIC_MAX_FILES }),
                maxFiles: PUBLIC_MAX_FILES,
                maxFileBytes: publicLimits.maxFileBytes
              };
            }
          }
          return out;
        },
        () => orgsFor(spec.scope, args)
      );
      return { result: result2 ?? null };
    }
    const userId = requireUser(req);
    if (req.params.method === "createProject" && typeof args[0] === "string") await svc.assertProjectRoom(args[0]);
    let doomed;
    const result = await transact(
      spec.mutates,
      async () => {
        if (req.params.method === "deleteIssue") doomed = repo.snapshot.issues.find((i) => i.id === args[0]) && structuredClone(repo.snapshot.issues.find((i) => i.id === args[0]));
        return repo[req.params.method](...args, userId);
      },
      () => orgsFor(spec.scope, args)
    );
    if (req.params.method === "createIssue" && result) emitter.issue("issue.created", result);
    else if (req.params.method === "updateIssue" && result) emitter.issue("issue.updated", result);
    else if (req.params.method === "deleteIssue" && doomed) emitter.issue("issue.deleted", doomed);
    else if (req.params.method === "addComment" && result) {
      const issue = repo.snapshot.issues.find((i) => i.id === args[0]);
      if (issue) emitter.comment(issue, result);
    }
    if ((req.params.method === "updateMemberRole" || req.params.method === "removeMember") && typeof args[0] === "string") {
      const who = store.load().users.find((u) => u.id === args[1])?.name ?? "someone";
      await owner.audit(args[0], userId, req.params.method === "updateMemberRole" ? "member.role" : args[1] === userId ? "member.leave" : "member.remove", req.params.method === "updateMemberRole" ? `${who} is now ${String(args[2])}` : who).catch(() => void 0);
    }
    return { result: result ?? null };
  });
  const owner = new DataOwner(db, store, repo.snapshot, accounts.twoFactor);
  const dangerLimiter = new RateLimiter(5, 10 * 6e4);
  const svc = registerServices({ app, db, store, repo, accounts, services: config.services ?? NO_SERVICES, publicUrl: config.publicUrl, secureCookies: config.secureCookies, allowSignup: config.allowSignup !== false, audit: (o, a, x, y) => owner.audit(o, a, x, y), requireUser, setSession, transact, ip, mockSecret: (0, import_node_crypto9.randomBytes)(32).toString("hex"), billingProvider: deps.billingProvider, aiProvider: deps.aiProvider });
  const stamp = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const exportOrg = async (req) => {
    const userId = requireUser(req);
    return transact(false, async () => {
      owner.requireOwner(req.params.orgId, userId);
      const { notifications: _mine, ...data } = await repo.loadOrg(req.params.orgId, userId);
      return data;
    }, async () => [req.params.orgId]);
  };
  app.get("/api/orgs/:orgId/export", async (req, reply) => {
    const data = await exportOrg(req);
    await owner.audit(req.params.orgId, req.userId, "org.export", "Full export (JSON)").catch(() => void 0);
    return reply.header("content-type", "application/json; charset=utf-8").header("content-disposition", `attachment; filename="${data.org.slug}-export-${stamp()}.json"`).send(JSON.stringify({ format: "abg-tracker-export-v1", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), ...data }, null, 2));
  });
  app.get("/api/orgs/:orgId/export.csv", async (req, reply) => {
    const data = await exportOrg(req);
    await owner.audit(req.params.orgId, req.userId, "org.export", "Work items (CSV)").catch(() => void 0);
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${data.org.slug}-items-${stamp()}.csv"`).send(issuesCsv(data));
  });
  app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: MAX_IMPORT_BYTES }, (_req, body, done) => done(null, body));
  const importLimiter = new RateLimiter(10, 60 * 6e4);
  app.post("/api/projects/:projectId/import", { bodyLimit: MAX_IMPORT_BYTES }, async (req) => {
    const userId = requireUser(req);
    if (!importLimiter.allow(userId)) throw new HttpError(429, "You have imported several times this hour. Try again later.");
    if (typeof req.body !== "string") throw new HttpError(400, "Send the CSV text as the request body.");
    const projectId = req.params.projectId;
    return transact(
      true,
      async () => {
        const project = repo.snapshot.projects.find((p) => p.id === projectId);
        if (!project || !store.load().memberships.some((m) => m.orgId === project.orgId && m.userId === userId)) throw new HttpError(404, "Project not found.");
        const members = store.load().memberships.filter((m) => m.orgId === project.orgId).flatMap((m) => store.load().users.filter((u) => u.id === m.userId));
        let plan;
        try {
          plan = planImport(req.body, project, members);
        } catch (e) {
          throw new HttpError(400, e.message);
        }
        const result = { created: 0, skipped: [...plan.skipped] };
        for (const { row, input } of plan.items) {
          try {
            await repo.createIssue(project.orgId, input, userId);
            result.created++;
          } catch (e) {
            if (e instanceof DomainError && /not allowed|not a member/i.test(e.message)) throw new HttpError(403, e.message);
            result.skipped.push({ row, reason: e instanceof DomainError ? e.message : "Could not create this item." });
          }
        }
        return result;
      },
      async () => {
        const o = await store.orgOf("projects", projectId);
        return o ? [o] : [];
      }
    );
  });
  app.get("/api/orgs/:orgId/audit", async (req) => ({ events: await owner.listAudit(req.params.orgId, requireUser(req)) }));
  app.post("/api/orgs/:orgId/delete", async (req) => {
    const userId = requireUser(req);
    if (!dangerLimiter.allow(userId)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
    const body = req.body ?? {};
    await transact(true, () => owner.deleteOrganization(req.params.orgId, userId, body.password, body.confirmName, body.code), async () => [req.params.orgId]);
    await webhooks.removeAllFor(req.params.orgId).catch(() => void 0);
    await files?.removeOrg(req.params.orgId).catch((err) => app.log.error({ err }, "could not delete stored files"));
    return { ok: true };
  });
  app.post("/api/me/delete", async (req, reply) => {
    const userId = requireUser(req);
    if (!dangerLimiter.allow(userId)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
    const body = req.body ?? {};
    await transact(true, () => owner.deleteAccount(userId, body.password, body.code), async () => store.load().memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    await tokens.revokeAll(userId);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  const emitter = makeEmitter({ store, repo, webhooks, baseUrl: config.publicUrl });
  registerPublicApi({ app, store, repo, webhooks, baseUrl: config.publicUrl, transact });
  const tokenLimiter = new RateLimiter(20, 60 * 6e4);
  const calendarLimiter = new RateLimiter(60, 60 * 6e4);
  app.get("/api/me/tokens", async (req) => ({ tokens: await tokens.list(requireUser(req)) }));
  app.post("/api/me/tokens", async (req) => {
    const userId = requireUser(req);
    if (!tokenLimiter.allow(userId)) throw new HttpError(429, "Too many tokens created. Try again later.");
    const body = req.body ?? {};
    const { token, view } = await tokens.create(userId, body.name, body.scope);
    return { token, view };
  });
  app.delete("/api/me/tokens/:id", async (req) => {
    if (!await tokens.revoke(requireUser(req), req.params.id)) throw new HttpError(404, "Token not found.");
    return { ok: true };
  });
  app.get("/api/cal/:file", async (req, reply) => {
    const m = /^(abg_[A-Za-z0-9_-]{20,80})\.ics$/.exec(req.params.file);
    const t2 = m ? await tokens.verify(m[1]) : null;
    if (!t2 || t2.scope !== "calendar") throw new HttpError(404, "Not found.");
    if (!calendarLimiter.allow(t2.id)) throw new HttpError(429, "Too many requests.");
    const orgIds = store.load().memberships.filter((x) => x.userId === t2.userId).map((x) => x.orgId);
    const items = await transact(false, async () => {
      const out = [];
      for (const issue of repo.snapshot.issues) {
        if (issue.assigneeId !== t2.userId || !issue.dueDate || !orgIds.includes(issue.orgId)) continue;
        const project = repo.snapshot.projects.find((p) => p.id === issue.projectId);
        const org2 = store.load().organizations.find((o) => o.id === issue.orgId);
        if (project && org2 && !isDone(project, issue)) out.push({ issue, project, orgName: org2.name, url: `${config.publicUrl}/${org2.slug}/p/${project.key}/board?issue=${issue.key}` });
      }
      return out;
    }, async () => orgIds);
    return reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "private, max-age=900").send(dueDatesIcs(items));
  });
  const requireAdmin = (orgId, userId) => {
    const role = store.load().memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;
    if (!role) throw new HttpError(403, "You are not a member of this organization.");
    if (role !== "owner" && role !== "admin") throw new HttpError(403, "Only owners and admins can manage webhooks.");
  };
  const orgSlug = (orgId) => store.load().organizations.find((o) => o.id === orgId)?.slug ?? "";
  app.get("/api/orgs/:orgId/webhooks", async (req) => {
    requireAdmin(req.params.orgId, requireUser(req));
    return { hooks: await webhooks.list(req.params.orgId), events: WEBHOOK_EVENTS };
  });
  app.post("/api/orgs/:orgId/webhooks", async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    const out = await webhooks.create(req.params.orgId, userId, req.body ?? {});
    await owner.audit(req.params.orgId, userId, "webhook.create", out.hook.url).catch(() => void 0);
    return out;
  });
  app.delete("/api/orgs/:orgId/webhooks/:id", async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    if (!await webhooks.remove(req.params.orgId, req.params.id)) throw new HttpError(404, "Webhook not found.");
    await owner.audit(req.params.orgId, userId, "webhook.delete").catch(() => void 0);
    return { ok: true };
  });
  app.post("/api/orgs/:orgId/webhooks/:id/active", async (req) => {
    requireAdmin(req.params.orgId, requireUser(req));
    const on = (req.body ?? {}).active === true;
    if (!await webhooks.setActive(req.params.orgId, req.params.id, on)) throw new HttpError(404, "Webhook not found.");
    return { ok: true };
  });
  app.post("/api/orgs/:orgId/webhooks/:id/test", async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    if (!tokenLimiter.allow(`test:${userId}`)) throw new HttpError(429, "Too many tests. Try again later.");
    return { result: await webhooks.ping(req.params.orgId, orgSlug(req.params.orgId), req.params.id) };
  });
  if (files) {
    const uploadLimiter = new RateLimiter(30, 6e4);
    const publicUploadLimiter = new RateLimiter(20, 6e4);
    const bodyLimit = limits.maxFileBytes + 4096;
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit }, (_req, body, done) => done(null, body));
    const acceptUpload = async (a) => {
      const name = cleanFileName(a.rawName);
      const problem = fileProblem(name, a.bytes.length, a.lim, blocked);
      if (problem) throw new HttpError(a.bytes.length > a.lim.maxFileBytes ? 413 : 400, problem);
      const mime = sniffImage(a.bytes) ?? "application/octet-stream";
      let written = null;
      try {
        return await transact(
          true,
          async () => {
            const { orgId } = repo.assertCanAttach(a.issueId, a.actorId);
            const w = await files.write(orgId, a.bytes);
            written = { orgId, key: w.key };
            const attachment = await repo.registerAttachment(a.issueId, { name, size: w.size, mime, sha256: w.sha256, storageKey: w.key }, a.lim, a.actorId, a.reg);
            return { attachment };
          },
          () => orgsFor({ kind: "record", table: "issues", arg: 0 }, [a.issueId])
        );
      } catch (e) {
        const w = written;
        if (w) await files.remove(w.orgId, w.key).catch(() => void 0);
        throw e;
      }
    };
    const nameFrom = (req) => {
      try {
        return decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
      } catch {
        return "";
      }
    };
    app.post(
      "/api/issues/:issueId/attachments",
      {
        bodyLimit,
        // Refuse anonymous uploads before the (large) body is even read.
        onRequest: async (req) => {
          if (!req.userId) throw new HttpError(401, "Please sign in.");
        }
      },
      async (req) => {
        const userId = requireUser(req);
        if (!uploadLimiter.allow(userId)) throw new HttpError(429, "You are uploading too quickly. Wait a moment and try again.");
        if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Send the file itself as the request body.");
        const commentId = typeof req.query.comment === "string" && req.query.comment ? req.query.comment : void 0;
        return acceptUpload({ issueId: req.params.issueId, actorId: userId, bytes: req.body, rawName: nameFrom(req), lim: limits, reg: { commentId } });
      }
    );
    const publicBodyLimit = publicLimits.maxFileBytes + 4096;
    app.post("/api/public/uploads/:token", { bodyLimit: publicBodyLimit }, async (req) => {
      if (!publicUploadLimiter.allow(ip(req))) throw new HttpError(429, "Too many uploads. Please wait a moment.");
      if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Send the file itself as the request body.");
      const ticket = tickets.use(req.params.token);
      if (!ticket) throw new HttpError(403, "This upload link has expired or was already used up. Send your request again.");
      return acceptUpload({ issueId: ticket.issueId, actorId: ticket.actorId, bytes: req.body, rawName: nameFrom(req), lim: publicLimits, reg: { externalName: ticket.submitterName } });
    });
    app.get("/api/files/:id", async (req, reply) => {
      const userId = requireUser(req);
      const rows = await db.query(`select data from attachments where id = $1`, [req.params.id]);
      const att = rows.length ? typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data : null;
      const member = att && store.load().memberships.some((m) => m.orgId === att.orgId && m.userId === userId);
      if (!att || !member) throw new HttpError(404, "File not found.");
      if (!await files.exists(att.orgId, att.storageKey)) throw new HttpError(404, "This file is missing from storage.");
      const sealed = (r) => r.header("content-security-policy", "default-src 'none'; sandbox").header("cache-control", "private, no-cache");
      if (req.query.thumb === "1") {
        if (!isInlineImage(att.mime)) throw new HttpError(415, "There is no preview for this kind of file.");
        if (!await files.hasThumb(att.orgId, att.storageKey)) {
          try {
            await files.writeThumb(att.orgId, att.storageKey, await makeThumbnail(await files.readAll(att.orgId, att.storageKey)));
          } catch {
            throw new HttpError(415, "This picture could not be previewed.");
          }
        }
        return sealed(reply).header("content-type", "image/webp").header("content-disposition", contentDisposition("inline", att.name.replace(/\.[^.]*$/, "") + ".webp")).send(files.readThumb(att.orgId, att.storageKey));
      }
      const inline = req.query.inline === "1" && isInlineImage(att.mime);
      return sealed(reply).header("content-type", inline ? att.mime : "application/octet-stream").header("content-disposition", contentDisposition(inline ? "inline" : "attachment", att.name)).header("content-length", att.size).send(files.read(att.orgId, att.storageKey));
    });
  }
  if (config.devTools && deps.mailer instanceof ConsoleMailer) {
    app.get("/api/dev/outbox", async () => ({ messages: deps.mailer.outbox }));
  }
  if (config.staticDir && (0, import_node_fs.existsSync)(import_node_path.default.join(config.staticDir, "index.html"))) {
    await app.register(import_static.default, {
      root: config.staticDir,
      // files are looked up per request, so a new build is served without restarting
      setHeaders: (res, filePath) => {
        res.header("cache-control", /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache");
      }
    });
    const indexPath = import_node_path.default.join(config.staticDir, "index.html");
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && (req.headers.accept ?? "").includes("text/html")) {
        return reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-cache").send((0, import_node_fs.readFileSync)(indexPath));
      }
      return reply.code(404).send({ error: "Not found." });
    });
  }
  app.decorate("remindDue", async (at = /* @__PURE__ */ new Date()) => {
    const day = (d) => d.toISOString().slice(0, 10);
    const from = day(new Date(at.getTime() - 4 * 864e5));
    const to = day(new Date(at.getTime() + 9 * 864e5));
    const rows = await db.query(`select distinct org_id from issues where data->>'dueDate' >= $1 and data->>'dueDate' <= $2 and data->>'assigneeId' is not null`, [from, to]);
    let created = 0;
    for (const r of rows) {
      const orgId = String(r.org_id);
      created += await transact(true, async () => repo.createDueReminders(orgId, at), async () => [orgId]);
    }
    return created;
  });
  return app;
}

// server/config.ts
var import_node_path2 = __toESM(require("node:path"), 1);
var bool = (v, fallback) => v === void 0 || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v);
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const problems = [];
  const port = Number(env.PORT ?? 4e3);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be a number between 1 and 65535.");
  const rawPublicUrl = env.PUBLIC_URL || env.APP_URL;
  const publicUrl = (rawPublicUrl ?? "http://localhost:3001").replace(/\/+$/, "");
  try {
    new URL(publicUrl);
  } catch {
    problems.push("PUBLIC_URL must be a full address such as https://tracker.example.com.");
  }
  if (production) {
    if (!rawPublicUrl) problems.push("PUBLIC_URL is required in production (it is used in invitation and reset links).");
    else if (!/^https:\/\//i.test(publicUrl) && !bool(env.ALLOW_INSECURE_HTTP, false)) problems.push("PUBLIC_URL must use https:// in production (set ALLOW_INSECURE_HTTP=1 only for a private test).");
    if (env.ALLOW_EMBEDDED_DB !== void 0 && !bool(env.ALLOW_EMBEDDED_DB, true) && !env.DATABASE_URL) {
      problems.push("DATABASE_URL is required when ALLOW_EMBEDDED_DB=0.");
    } else if (bool(env.REQUIRE_POSTGRES, false) && !env.DATABASE_URL) {
      problems.push("DATABASE_URL is required when REQUIRE_POSTGRES=1.");
    }
    if (bool(env.SEED_DEMO, false)) problems.push("SEED_DEMO must not be enabled in production: it creates accounts with a publicly known password.");
  }
  for (const [name, min] of [["ORG_CACHE_MAX", 1], ["ORG_CACHE_IDLE_MINUTES", 1], ["MAX_FILE_MB", 1], ["PUBLIC_MAX_FILE_MB", 1], ["ORG_STORAGE_MB", 1], ["MAX_FILES_PER_ISSUE", 1]]) {
    if (env[name] !== void 0 && !(Number.isFinite(Number(env[name])) && Number(env[name]) >= min)) problems.push(`${name} must be a number of at least ${min}.`);
  }
  if (env.DIGEST_HOUR !== void 0 && !(Number.isInteger(Number(env.DIGEST_HOUR)) && Number(env.DIGEST_HOUR) >= 0 && Number(env.DIGEST_HOUR) <= 23)) problems.push("DIGEST_HOUR must be a whole number from 0 to 23.");
  const mockOk = !production || bool(env.ALLOW_MOCK_SERVICES, false);
  const mode = (name) => {
    const v = (env[name] ?? (mockOk ? "mock" : "none")).toLowerCase();
    if (v !== "none" && v !== "mock") problems.push(`${name}=${v} is not available yet. Use none or mock; real providers are added by the development team (see docs/INTEGRATION-HANDOFF.md).`);
    else if (v === "mock" && !mockOk) problems.push(`${name}=mock pretends to be a real service, so it is refused in production. Set ALLOW_MOCK_SERVICES=1 only for a demo, or use none.`);
    return v === "mock" ? "mock" : "none";
  };
  const services = { billing: mode("BILLING_PROVIDER"), sso: mode("SSO_PROVIDER"), ai: mode("AI_PROVIDER") };
  if (env.SMTP_URL) {
    try {
      const u = new URL(env.SMTP_URL);
      if (!/^smtps?:$/.test(u.protocol)) problems.push("SMTP_URL must start with smtp:// or smtps://.");
    } catch {
      problems.push("SMTP_URL is not a valid address (expected smtp://user:password@host:587).");
    }
  }
  if (env.MONGODB_URI) {
    const trimmed = env.MONGODB_URI.trim();
    if (!trimmed.startsWith("mongodb://") && !trimmed.startsWith("mongodb+srv://")) {
      problems.push("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
    }
  }
  if (problems.length) throw new Error(`Invalid configuration:
 - ${problems.join("\n - ")}`);
  return {
    production,
    port,
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    databaseUrl: env.DATABASE_URL || void 0,
    mongodbUri: env.MONGODB_URI?.trim() || void 0,
    dataDir: import_node_path2.default.resolve(env.DATA_DIR ?? "server-data"),
    publicUrl,
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    seedDemo: bool(env.SEED_DEMO, false),
    smtpUrl: env.SMTP_URL || void 0,
    mailFrom: env.MAIL_FROM ?? "ABG Tracker <no-reply@localhost>",
    staticDir: import_node_path2.default.resolve(env.STATIC_DIR ?? "dist"),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxy: bool(env.TRUST_PROXY, false),
    orgCacheMax: Number(env.ORG_CACHE_MAX ?? 50),
    orgCacheIdleMinutes: Number(env.ORG_CACHE_IDLE_MINUTES ?? 30),
    filesDir: import_node_path2.default.resolve(env.FILES_DIR ?? "server-files"),
    maxFileMb: Number(env.MAX_FILE_MB ?? 25),
    publicMaxFileMb: Number(env.PUBLIC_MAX_FILE_MB ?? 10),
    orgStorageMb: Number(env.ORG_STORAGE_MB ?? 1024),
    maxFilesPerIssue: Number(env.MAX_FILES_PER_ISSUE ?? 25),
    digestHour: Number(env.DIGEST_HOUR ?? 8),
    services,
    blockedExtensions: env.BLOCKED_EXTENSIONS !== void 0 ? env.BLOCKED_EXTENSIONS.split(",").map((x) => x.trim().toLowerCase().replace(/^\./, "")).filter(Boolean) : [...BLOCKED_EXTENSIONS]
  };
}

// server/files.ts
var import_node_crypto10 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_path3 = __toESM(require("node:path"), 1);
var ORG_RE = /^[A-Za-z0-9_-]{1,64}$/;
var KEY_RE = /^[a-f0-9]{32}$/;
var FileStore = class {
  constructor(root) {
    this.root = root;
  }
  root;
  locate(orgId, key, variant) {
    if (!ORG_RE.test(orgId) || !KEY_RE.test(key)) throw new Error("Invalid file location.");
    return import_node_path3.default.join(this.root, orgId, key.slice(0, 2), variant === "thumb" ? `${key}.thumb` : key);
  }
  /** The whole file in memory (files are capped at a few tens of MB). */
  readAll(orgId, key) {
    return (0, import_promises2.readFile)(this.locate(orgId, key));
  }
  async hasThumb(orgId, key) {
    try {
      return (await (0, import_promises2.stat)(this.locate(orgId, key, "thumb"))).isFile();
    } catch {
      return false;
    }
  }
  async writeThumb(orgId, key, bytes) {
    const target = this.locate(orgId, key, "thumb");
    const tmp = `${target}.part`;
    await (0, import_promises2.writeFile)(tmp, bytes, { mode: 384 });
    await (0, import_promises2.rename)(tmp, target);
  }
  readThumb(orgId, key) {
    return (0, import_node_fs2.createReadStream)(this.locate(orgId, key, "thumb"));
  }
  /** Writes the bytes (atomically: temp file, then rename) and returns how to find them again. */
  async write(orgId, bytes) {
    const key = (0, import_node_crypto10.randomBytes)(16).toString("hex");
    const target = this.locate(orgId, key);
    await (0, import_promises2.mkdir)(import_node_path3.default.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    await (0, import_promises2.writeFile)(tmp, bytes, { mode: 384 });
    await (0, import_promises2.rename)(tmp, target);
    return { key, sha256: (0, import_node_crypto10.createHash)("sha256").update(bytes).digest("hex"), size: bytes.length };
  }
  read(orgId, key) {
    return (0, import_node_fs2.createReadStream)(this.locate(orgId, key));
  }
  async exists(orgId, key) {
    try {
      return (await (0, import_promises2.stat)(this.locate(orgId, key))).isFile();
    } catch {
      return false;
    }
  }
  /**
   * Deletes files nothing refers to any more (a crash between writing the bytes and saving the record,
   * or a leftover temp file). `isKnown` says whether a record still uses a key. Files younger than
   * `minAgeMs` are never touched, so an upload that is still being saved is safe. Returns how many were removed.
   */
  async sweep(isKnown, minAgeMs, now2 = Date.now()) {
    let removed = 0;
    const dirs = async (p) => {
      try {
        return await (0, import_promises2.readdir)(p, { withFileTypes: true });
      } catch {
        return [];
      }
    };
    for (const org2 of await dirs(this.root)) {
      if (!org2.isDirectory() || !ORG_RE.test(org2.name)) continue;
      for (const shard of await dirs(import_node_path3.default.join(this.root, org2.name))) {
        if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
        for (const f of await dirs(import_node_path3.default.join(this.root, org2.name, shard.name))) {
          const m = /^([a-f0-9]{32})(\.thumb)?(\.part)?$/.exec(f.name);
          if (!f.isFile() || !m || m[1].slice(0, 2) !== shard.name) continue;
          if (!m[3] && isKnown(org2.name, m[1])) continue;
          const full = import_node_path3.default.join(this.root, org2.name, shard.name, f.name);
          try {
            if (now2 - (await (0, import_promises2.stat)(full)).mtimeMs < minAgeMs) continue;
            await (0, import_promises2.rm)(full, { force: true });
            removed++;
          } catch {
          }
        }
      }
    }
    return removed;
  }
  /** Removes everything stored for an organization (when the organization is deleted). */
  async removeOrg(orgId) {
    if (!ORG_RE.test(orgId)) throw new Error("Invalid file location.");
    await (0, import_promises2.rm)(import_node_path3.default.join(this.root, orgId), { recursive: true, force: true });
  }
  /** Deleting something already gone is fine. */
  async remove(orgId, key) {
    await (0, import_promises2.rm)(this.locate(orgId, key), { force: true });
    await (0, import_promises2.rm)(this.locate(orgId, key, "thumb"), { force: true });
  }
};

// server/notifier.ts
var MAX_LISTED = 25;
var RETRY_AFTER_MS = 15 * 6e4;
var DIGEST_GAP_MS = 20 * 60 * 6e4;
var oneLine = (s2, max = 140) => String(s2 ?? "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
var parse2 = (v) => typeof v === "string" ? JSON.parse(v) : v;
var NotificationEmailer = class {
  retryAt = /* @__PURE__ */ new Map();
  opts;
  constructor(opts) {
    this.opts = { graceMs: 2 * 6e4, windowMs: 2 * 24 * 60 * 6e4, digestHour: 8, log: (l) => console.log(l), ...opts, unsubscribe: opts.unsubscribe ?? new Unsubscribe(opts.db) };
  }
  /** One pass. Returns how many emails were sent. */
  async runOnce(at = /* @__PURE__ */ new Date()) {
    const { db, store, windowMs, graceMs, digestHour } = this.opts;
    const since = new Date(at.getTime() - windowMs).toISOString();
    const rows = await db.query(
      `select n.id, n.data from notifications n
         left join notification_emails e on e.notification_id = n.id
        where e.notification_id is null and n.data->>'createdAt' > $1
        order by n.data->>'createdAt' limit 2000`,
      [since]
    );
    if (rows.length === 0) return this.cleanup(at);
    const data = store.load();
    const byUser = /* @__PURE__ */ new Map();
    const skip = [];
    for (const r of rows) {
      const n = parse2(r.data);
      const user = data.users.find((u) => u.id === n.userId);
      const prefs = resolvePrefs(user);
      const member = data.memberships.some((m) => m.orgId === n.orgId && m.userId === n.userId);
      if (!user || !member || n.read || !wantsEmail(prefs, n.kind, n.projectId)) skip.push(n.id);
      else byUser.set(n.userId, [...byUser.get(n.userId) ?? [], n]);
    }
    await this.mark(skip, "skipped");
    let sent = 0;
    for (const [userId, items] of byUser) {
      const user = data.users.find((u) => u.id === userId);
      const prefs = resolvePrefs(user);
      if ((this.retryAt.get(userId) ?? 0) > at.getTime()) continue;
      let due;
      if (prefs.email === "daily") {
        if (localHour(at, prefs.timeZone) < digestHour) continue;
        const last = await db.query(`select last_sent from digest_state where user_id = $1`, [userId]);
        if (last.length && at.getTime() - new Date(String(last[0].last_sent)).getTime() < DIGEST_GAP_MS) continue;
        due = items;
      } else {
        due = items.filter((n) => at.getTime() - new Date(n.createdAt).getTime() >= graceMs);
      }
      if (due.length === 0) continue;
      const claimed = await this.claim(due.map((n) => n.id));
      const mine = due.filter((n) => claimed.has(n.id));
      if (mine.length === 0) continue;
      try {
        await this.opts.mailer.send(await this.compose(user.name, user.email, mine, prefs.email === "daily"));
        if (prefs.email === "daily") {
          await db.query(`insert into digest_state (user_id, last_sent) values ($1, $2) on conflict (user_id) do update set last_sent = excluded.last_sent`, [userId, at.toISOString()]);
        }
        sent++;
      } catch (e) {
        for (const n of mine) await db.query(`delete from notification_emails where notification_id = $1`, [n.id]);
        this.retryAt.set(userId, at.getTime() + RETRY_AFTER_MS);
        this.opts.log(`Could not email a notification summary: ${e instanceof Error ? e.message : e}`);
      }
    }
    await this.cleanup(at);
    return sent;
  }
  async mark(ids, outcome) {
    for (const id of ids) await this.opts.db.query(`insert into notification_emails (notification_id, outcome) values ($1, $2) on conflict do nothing`, [id, outcome]);
  }
  async claim(ids) {
    const got = /* @__PURE__ */ new Set();
    for (const id of ids) {
      const r = await this.opts.db.query(`insert into notification_emails (notification_id, outcome) values ($1, 'sent') on conflict do nothing returning notification_id`, [id]);
      if (r.length) got.add(id);
    }
    return got;
  }
  /** Forgets old bookkeeping (and old retry timers). */
  async cleanup(at) {
    await this.opts.db.query(`delete from notification_emails where handled_at < $1`, [new Date(at.getTime() - 30 * 24 * 60 * 6e4).toISOString()]);
    for (const [k, t2] of this.retryAt) if (t2 < at.getTime()) this.retryAt.delete(k);
    return 0;
  }
  async lookup(table, ids) {
    const out = /* @__PURE__ */ new Map();
    if (ids.length === 0) return out;
    const marks = ids.map((_, i) => `$${i + 1}`).join(",");
    for (const r of await this.opts.db.query(`select id, data from ${table} where id in (${marks})`, ids)) out.set(String(r.id), parse2(r.data));
    return out;
  }
  async compose(name, to, items, daily) {
    const { store, baseUrl } = this.opts;
    const data = store.load();
    const unsubscribeUrl = `${baseUrl}/unsubscribe/${await this.opts.unsubscribe.token(items[0].userId)}`;
    const issues = await this.lookup("issues", [...new Set(items.map((n) => n.issueId))]);
    const projects = await this.lookup("projects", [...new Set(items.map((n) => n.projectId))]);
    const line = (n) => {
      const actor = data.users.find((u) => u.id === n.actorId)?.name ?? (n.actorId === "automation" ? "An automation" : n.actorId === "intake" ? "A request form" : n.actorId === "reminder" ? "Reminder" : "Someone");
      const issue = issues.get(n.issueId);
      const project = projects.get(n.projectId);
      const org2 = data.organizations.find((o) => o.id === n.orgId);
      const what = issue ? `${oneLine(issue.key, 30)} ${oneLine(issue.title)}` : "an item that was deleted";
      const link = issue && project && org2 ? `${baseUrl}/${encodeURIComponent(org2.slug)}/p/${encodeURIComponent(String(project.key))}/board?issue=${encodeURIComponent(String(issue.key))}` : "";
      return { text: `${oneLine(actor, 60)} ${NOTIFY_VERB[n.kind]} ${what}`, detail: n.detail ? oneLine(n.detail, 200) : "", link, org: org2?.name ?? "" };
    };
    const lines = items.map(line);
    const subject = daily ? `Your daily summary: ${items.length} update${items.length === 1 ? "" : "s"}` : items.length === 1 ? lines[0].text.slice(0, 150) : `${items.length} updates on your work`;
    const shown = lines.slice(0, MAX_LISTED).map((l) => `\u2022 ${l.text}${l.org && data.organizations.length > 1 ? ` (${oneLine(l.org, 60)})` : ""}${l.detail ? `
    \u201C${l.detail}\u201D` : ""}${l.link ? `
    ${l.link}` : ""}`);
    const more = lines.length > MAX_LISTED ? `
\u2026and ${lines.length - MAX_LISTED} more in your Inbox.` : "";
    const text2 = [
      `Hi ${oneLine(name, 60) || "there"},`,
      "",
      daily ? "Here is what happened on your work:" : items.length === 1 ? "Something needs your attention:" : "Here is what is new on your work:",
      "",
      shown.join("\n\n") + more,
      "",
      `Open your Inbox: ${baseUrl}/`,
      `Want fewer of these? In the app open Inbox \u2192 Email settings.`,
      `Stop all of these emails: ${unsubscribeUrl}`
    ].join("\n");
    return { to, subject: oneLine(subject, 150), text: text2, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  }
};

// server/mongodb.ts
var import_mongodb = require("mongodb");
var clientInstance = null;
var currentDbName = void 0;
function redactMongoUri(uri) {
  if (!uri || typeof uri !== "string") return "";
  try {
    const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)@([^/?#]+)(.*)$/i);
    if (match) {
      return `${match[1]}****:****@${match[3]}${match[4]}`;
    }
    return uri;
  } catch {
    return "mongodb://[REDACTED]";
  }
}
function isValidMongoUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  const trimmed = uri.trim();
  return trimmed.startsWith("mongodb://") || trimmed.startsWith("mongodb+srv://");
}
function extractDatabaseName(uri) {
  if (!uri || typeof uri !== "string") return void 0;
  try {
    const withoutProtocol = uri.replace(/^mongodb(?:\+srv)?:\/\//i, "");
    const slashIdx = withoutProtocol.indexOf("/");
    if (slashIdx === -1) return void 0;
    const pathAndQuery = withoutProtocol.slice(slashIdx + 1);
    const qIdx = pathAndQuery.indexOf("?");
    const dbSegment = qIdx === -1 ? pathAndQuery : pathAndQuery.slice(0, qIdx);
    const decoded = decodeURIComponent(dbSegment.trim());
    return decoded || void 0;
  } catch {
    return void 0;
  }
}
function getDefaultMongoOptions() {
  return {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5e3,
    connectTimeoutMS: 1e4,
    retryWrites: true
  };
}
async function initMongoClient(uri, options) {
  const targetUri = uri || process.env.MONGODB_URI;
  if (!targetUri) {
    return null;
  }
  if (!isValidMongoUri(targetUri)) {
    throw new Error("MONGODB_URI must start with mongodb:// or mongodb+srv://");
  }
  if (clientInstance) {
    return clientInstance;
  }
  const mergedOptions = {
    ...getDefaultMongoOptions(),
    ...options
  };
  const client = new import_mongodb.MongoClient(targetUri, mergedOptions);
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  clientInstance = client;
  currentDbName = extractDatabaseName(targetUri) || "abg_tracker";
  const redacted = redactMongoUri(targetUri);
  console.log(`MongoDB Atlas client connected (${redacted}, database: ${currentDbName})`);
  return clientInstance;
}
async function closeMongoClient() {
  if (clientInstance) {
    try {
      await clientInstance.close();
      console.log("MongoDB connection closed.");
    } finally {
      clientInstance = null;
      currentDbName = void 0;
    }
  }
}

// server/index.ts
async function main() {
  const cfg = loadConfig();
  const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.databaseUrl ? void 0 : cfg.dataDir });
  await migrate(db);
  await purgeExpired(db);
  const store = await PostgresSnapshotStore.open(db);
  const repo = new LocalRepository(store);
  const mailer = createMailer(cfg.smtpUrl, cfg.mailFrom, { verbose: !cfg.production });
  if (cfg.production && mailer.kind === "console") {
    console.warn("WARNING: SMTP_URL is not set. Invitation and password-reset emails will NOT be delivered. Admins must share invite links by hand and password reset will not work.");
  }
  const mailErrors = [];
  const accounts = new Accounts(db, store, repo.snapshot, mailer, (e) => {
    mailErrors.push(e);
    console.error("Could not send email:", e instanceof Error ? e.message : e);
  });
  if (cfg.seedDemo && await accounts.seedDemo()) {
    console.log(`Demo data loaded. Sign in as alex@acme.dev, priya@acme.dev, sam@acme.dev (Acme) or jordan@northwind.io, maya@northwind.io (Northwind) with password "${DEMO_PASSWORD}".`);
  }
  if (cfg.mongodbUri) {
    try {
      await initMongoClient(cfg.mongodbUri);
    } catch (e) {
      console.error("Could not connect to MongoDB Atlas:", e instanceof Error ? e.message : e);
    }
  }
  const files = new FileStore(cfg.filesDir);
  const app = await buildApp({
    db,
    store,
    repo,
    accounts,
    mailer,
    files,
    attachmentLimits: { maxFileBytes: cfg.maxFileMb * 1024 * 1024, maxFilesPerIssue: cfg.maxFilesPerIssue, orgQuotaBytes: cfg.orgStorageMb * 1024 * 1024 },
    blockedExtensions: cfg.blockedExtensions,
    publicMaxFileBytes: cfg.publicMaxFileMb * 1024 * 1024,
    config: {
      secureCookies: cfg.production,
      publicUrl: cfg.publicUrl,
      logger: true,
      trustProxy: cfg.trustProxy,
      allowSignup: cfg.allowSignup,
      staticDir: cfg.staticDir,
      devTools: !cfg.production,
      orgCache: { max: cfg.orgCacheMax, idleMs: cfg.orgCacheIdleMinutes * 6e4 },
      services: cfg.services
    }
  });
  const sweep = setInterval(() => void purgeExpired(db).catch(() => void 0), 60 * 6e4);
  sweep.unref();
  const sweepFiles = async () => {
    const rows = await db.query(`select org_id, data->>'storageKey' as k from attachments`);
    const known = new Set(rows.map((r) => `${r.org_id}/${r.k}`));
    const n = await files.sweep((org2, key) => known.has(`${org2}/${key}`), 24 * 60 * 6e4);
    if (n) console.log(`Removed ${n} unused stored file${n === 1 ? "" : "s"}.`);
  };
  const sweepNow = () => void sweepFiles().catch((e) => console.error("File cleanup failed:", e instanceof Error ? e.message : e));
  setTimeout(sweepNow, 2 * 6e4).unref();
  setInterval(sweepNow, 6 * 60 * 6e4).unref();
  const remind = () => void app.remindDue().catch((e) => console.error("Due reminders failed:", e instanceof Error ? e.message : e));
  setTimeout(remind, 3e4).unref();
  setInterval(remind, 15 * 6e4).unref();
  if (mailer.kind === "smtp" || !cfg.production) {
    const emailer = new NotificationEmailer({ db, store, mailer, baseUrl: cfg.publicUrl, digestHour: cfg.digestHour, log: (l) => console.error(l) });
    const tick = setInterval(() => void emailer.runOnce().catch((e) => console.error("Notification emails failed:", e instanceof Error ? e.message : e)), 6e4);
    tick.unref();
  }
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing in-flight requests\u2026`);
    try {
      await app.close();
      await store.flush();
      await db.close();
      await closeMongoClient();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(
    `ABG Tracker on http://${cfg.host}:${cfg.port} \xB7 database: ${db.kind}${cfg.mongodbUri ? " \xB7 mongodb: configured" : ""} \xB7 email: ${mailer.kind}${mailer.kind === "console" ? " (not delivered)" : ""} \xB7 sign-up: ${cfg.allowSignup ? "open" : "invite only"}${cfg.production ? " \xB7 production" : ""}`
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
