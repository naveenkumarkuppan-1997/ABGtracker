import { useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { Check, Send, Sparkles, X } from 'lucide-react';
import { create } from 'zustand';
import { useApp } from '@/store/app';
import { localCopilot, SUGGESTIONS, type CopilotContext, type ProposedAction } from '@/domain/copilot';
import { Button, cn } from './ui';
import { Markdown } from './Markdown';

type ActionState = 'idle' | 'applying' | 'applied' | 'failed' | 'dismissed';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  actions?: (ProposedAction & { state: ActionState })[];
}

interface CopilotState {
  open: boolean;
  messages: Message[];
  busy: boolean;
  setOpen: (o: boolean) => void;
  push: (m: Omit<Message, 'id'>) => void;
  setAction: (msgId: number, actionId: string, state: ActionState) => void;
  setBusy: (b: boolean) => void;
  clear: () => void;
}

let nextId = 1;
const WELCOME: Omit<Message, 'id'> = {
  role: 'assistant',
  text: "Hi! I'm your project co-pilot. Ask me for a **status update**, what's **at risk**, who is **overloaded**, or tell me to create or change issues. I'll always ask before changing anything.",
};

const useCopilot = create<CopilotState>((set) => ({
  open: false,
  messages: [{ id: nextId++, ...WELCOME }],
  busy: false,
  setOpen: (open) => set({ open }),
  push: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: nextId++ }] })),
  setAction: (msgId, actionId, state) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === msgId ? { ...m, actions: m.actions?.map((a) => (a.id === actionId ? { ...a, state } : a)) } : m)),
    })),
  setBusy: (busy) => set({ busy }),
  clear: () => set({ messages: [{ id: nextId++, ...WELCOME }] }),
}));

export function CopilotButton() {
  const open = useCopilot((s) => s.open);
  const setOpen = useCopilot((s) => s.setOpen);
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg shadow-card hover:opacity-90"
        >
          <Sparkles size={16} /> Copilot
        </button>
      )}
      {open && <CopilotPanel />}
    </>
  );
}

function describeAction(a: ProposedAction) {
  return a.label;
}

function CopilotPanel() {
  const { messages, busy, setOpen, push, setAction, setBusy, clear } = useCopilot();
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const { createIssue, updateIssue, addComment } = useApp();
  const match = useMatch('/:orgSlug/p/:projectKey/*');
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const project = match ? data.projects.find((p) => p.key === match.params.projectKey) : undefined;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    push({ role: 'user', text: t });
    setBusy(true);
    const ctx: CopilotContext = {
      userId,
      members: data.members,
      projects: data.projects,
      project,
      issues: data.issues,
      sprints: data.sprints,
      activity: data.activity,
      now: new Date(),
    };
    try {
      const reply = await localCopilot.respond(t, ctx);
      push({ role: 'assistant', text: reply.text, actions: reply.actions.map((a) => ({ ...a, state: 'idle' as const })) });
    } catch {
      push({ role: 'assistant', text: 'Sorry, something went wrong while working that out.' });
    } finally {
      setBusy(false);
    }
  };

  const apply = async (msgId: number, a: ProposedAction): Promise<boolean> => {
    setAction(msgId, a.id, 'applying');
    let ok = false;
    if (a.type === 'create_issue') ok = !!(await createIssue(a.input));
    else if (a.type === 'update_issue') ok = await updateIssue(a.issueId, a.patch);
    else ok = await addComment(a.issueId, a.body);
    setAction(msgId, a.id, ok ? 'applied' : 'failed');
    return ok;
  };

  return (
    <aside role="complementary" aria-label="Copilot" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles size={16} className="text-accent-text" />
        <h2 className="font-semibold">Copilot</h2>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{project ? project.name : 'All projects'}</span>
        <button onClick={clear} className="ml-auto text-xs text-muted underline hover:text-fg">
          Clear
        </button>
        <button aria-label="Close copilot" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg">
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m) => {
          const pending = m.actions?.filter((a) => a.state === 'idle') ?? [];
          return (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[92%] rounded-2xl px-3.5 py-2.5', m.role === 'user' ? 'bg-primary text-primary-fg' : 'bg-surface-2')}>
                {m.role === 'user' ? <p className="text-sm">{m.text}</p> : <Markdown text={m.text} members={data.members} />}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Proposed changes</p>
                    {m.actions.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
                        <span className={cn('min-w-0 flex-1', a.state === 'dismissed' && 'text-muted line-through')}>{describeAction(a)}</span>
                        {a.state === 'idle' && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => void apply(m.id, a)}>
                              Apply
                            </Button>
                            <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setAction(m.id, a.id, 'dismissed')}>
                              <X size={12} />
                            </Button>
                          </>
                        )}
                        {a.state === 'applying' && <span className="text-muted">Applying…</span>}
                        {a.state === 'applied' && (
                          <span className="inline-flex items-center gap-1 text-[#2f9e6b]">
                            <Check size={12} /> Done
                          </span>
                        )}
                        {a.state === 'failed' && <span className="text-danger">Not applied</span>}
                      </div>
                    ))}
                    {pending.length > 1 && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          for (const a of pending) if (!(await apply(m.id, a))) break;
                        }}
                      >
                        Apply all {pending.length}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {busy && <p className="text-xs text-muted">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => void ask(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <input
            aria-label="Ask the copilot"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask or tell me what to do…"
            className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-accent"
          />
          <Button type="submit" variant="primary" disabled={!input.trim() || busy} aria-label="Send">
            <Send size={14} />
          </Button>
        </form>
        <p className="text-[11px] text-muted">Runs locally on your project data. No external AI model is connected yet.</p>
      </div>
    </aside>
  );
}
