import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/data/apiRepository';
import { useApp } from '@/store/app';
import { Button } from './ui';

/** "Summarize": a short recap of an item and its discussion. Shown only when the server has an AI assistant connected. */
export function AiSummary({ slug, issueKey }: { slug: string; issueKey: string }) {
  const available = useApp((s) => s.serverConfig?.ai);
  const [text, setText] = useState<{ summary: string; provider: string; mock: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available) return null;
  return (
    <section aria-label="Summary">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setText(await api.summarize(slug, issueKey));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not summarize.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Sparkles size={13} /> {busy ? 'Summarizing…' : text ? 'Summarize again' : 'Summarize'}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
      {text && (
        <div className="mt-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          <p className="whitespace-pre-line">{text.summary}</p>
          <p className="mt-2 text-xs text-muted">
            Written by {text.provider}. Check it against the item before relying on it.
          </p>
        </div>
      )}
    </section>
  );
}
