import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { splitMentions } from '@/domain/mentions';
import type { Member } from '@/domain/types';
import { cn, Textarea } from './ui';

// A deliberately small Markdown subset rendered to React elements (never raw HTML),
// so user content can't inject markup: headings, **bold**, *italic*, `code`, ``` blocks,
// lists, [links](https://…) and @mentions.

function inline(text: string, members: Pick<Member, 'name'>[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0;
  let n = 0;
  const pushPlain = (s: string) => {
    for (const seg of splitMentions(s, members)) {
      out.push(
        seg.mention ? (
          <span key={`${keyBase}-${n++}`} className="rounded bg-accent/20 px-1 font-medium">
            {seg.text}
          </span>
        ) : (
          <Fragment key={`${keyBase}-${n++}`}>{seg.text}</Fragment>
        )
      );
    }
  };
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) pushPlain(text.slice(last, i));
    const tok = m[0];
    const k = `${keyBase}-${n++}`;
    if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(tok)!;
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="text-accent-text underline">
          {label}
        </a>
      );
    }
    last = i + tok.length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return out;
}

export function Markdown({ text, members = [], className }: { text: string; members?: Pick<Member, 'name'>[]; className?: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const nodes: ReactNode[] = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('```')) {
        const buf: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
        i++;
        nodes.push(
          <pre key={key++} className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
            {buf.join('\n')}
          </pre>
        );
      } else if (/^#{1,3}\s/.test(line)) {
        const level = line.match(/^#+/)![0].length;
        const content = inline(line.replace(/^#+\s/, ''), members, `h${key}`);
        nodes.push(
          <p key={key++} className={cn('font-semibold', level === 1 ? 'text-base' : 'text-sm')}>
            {content}
          </p>
        );
        i++;
      } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items: ReactNode[] = [];
        while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))) {
          items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), members, `l${key}-${items.length}`)}</li>);
          i++;
        }
        nodes.push(ordered ? <ol key={key++} className="list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={key++} className="list-disc space-y-0.5 pl-5">{items}</ul>);
      } else if (line.trim() === '') {
        i++;
      } else {
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^#{1,3}\s/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) buf.push(lines[i++]);
        nodes.push(
          <p key={key++}>
            {buf.map((l, idx) => (
              <Fragment key={idx}>
                {idx > 0 && <br />}
                {inline(l, members, `p${key}-${idx}`)}
              </Fragment>
            ))}
          </p>
        );
      }
    }
    return nodes;
  }, [text, members]);

  return <div className={cn('space-y-2 break-words text-sm leading-relaxed', className)}>{blocks}</div>;
}

/** Textarea with Write / Preview tabs and @mention autocomplete. */
export function RichEditor({
  value,
  onChange,
  onBlur,
  members,
  rows = 4,
  placeholder,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  members: Pick<Member, 'id' | 'name'>[];
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  label: string;
}) {
  const [preview, setPreview] = useState(false);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = query ? members.filter((m) => m.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 5) : [];

  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = /(?:^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(before);
    if (m) {
      setQuery({ start: caret - m[1].length - 1, text: m[1] });
      setActive(0);
    } else setQuery(null);
  };

  const insert = (name: string) => {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const next = `${value.slice(0, query.start)}@${name} ${value.slice(caret)}`;
    onChange(next);
    setQuery(null);
    const pos = query.start + name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div>
      <div className="mb-1 flex gap-3 text-xs">
        {(['Write', 'Preview'] as const).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setPreview(t === 'Preview')}
            className={cn('border-b-2 pb-0.5', (t === 'Preview') === preview ? 'border-accent font-medium' : 'border-transparent text-muted')}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-muted">Markdown · type @ to mention</span>
      </div>
      {preview ? (
        <div className="min-h-20 rounded-md border border-line bg-surface p-3">
          {value.trim() ? <Markdown text={value} members={members} /> : <span className="text-sm text-muted">Nothing to preview</span>}
        </div>
      ) : (
        <div className="relative">
          <Textarea
            ref={ref}
            aria-label={label}
            rows={rows}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              onChange(e.target.value);
              detect(e.target.value, e.target.selectionStart);
            }}
            onBlur={() => {
              setTimeout(() => setQuery(null), 120);
              onBlur?.();
            }}
            onKeyDown={(e) => {
              if (!query || !matches.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => (a + 1) % matches.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a - 1 + matches.length) % matches.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insert(matches[active].name);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setQuery(null);
              }
            }}
          />
          {query && matches.length > 0 && (
            <ul role="listbox" className="absolute left-2 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              {matches.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(m.name);
                    }}
                    className={cn('block w-full px-3 py-1.5 text-left text-sm', i === active ? 'bg-surface-2' : 'hover:bg-surface-2')}
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
