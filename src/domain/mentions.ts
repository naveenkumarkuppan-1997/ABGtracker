import type { ID, Member } from './types';

/** The reactions people can add to a comment. */
export const REACTIONS = ['👍', '✅', '🎉', '❤️', '👀', '😄'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentionRegex(members: Pick<Member, 'name'>[]): RegExp | null {
  if (!members.length) return null;
  const names = members.map((m) => escapeRe(m.name)).sort((a, b) => b.length - a.length);
  return new RegExp(`@(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

/** User ids mentioned as "@Full Name" in `body`. */
export function extractMentions(body: string, members: Pick<Member, 'id' | 'name'>[]): ID[] {
  const re = mentionRegex(members);
  if (!re) return [];
  const found = new Set<ID>();
  for (const m of body.matchAll(re)) {
    const user = members.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (user) found.add(user.id);
  }
  return [...found];
}

export type Segment = { text: string; mention: boolean };

/** Splits text into plain and @mention segments (for highlighting). */
export function splitMentions(body: string, members: Pick<Member, 'name'>[]): Segment[] {
  const re = mentionRegex(members);
  if (!re) return [{ text: body, mention: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}
