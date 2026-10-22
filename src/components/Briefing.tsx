import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { api, type Briefing as BriefingData } from '@/data/apiRepository';
import { useApp } from '@/store/app';
import { Button } from './ui';

const cacheKey = (orgId: string, userId: string) => `abg2:briefing:${orgId}:${userId}`;
const read = (key: string): BriefingData | null => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

/**
 * "Your day, in brief": a few plain sentences and a suggested order for today, written by the AI assistant from the
 * person's own work. It only reads. It runs when asked (and is remembered for the rest of the visit), so it costs
 * nothing until someone wants it.
 */
export function BriefingCard({ slug, orgId, projectKeys }: { slug: string; orgId: string; projectKeys: Record<string, string> }) {
  const userId = useApp((s) => s.userId);
  const key = cacheKey(orgId, userId);
  const [brief, setBrief] = useState<BriefingData | null>(() => read(key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await api.briefing(slug);
      setBrief(b);
      try {
        sessionStorage.setItem(key, JSON.stringify(b));
      } catch {
        /* works without remembering */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the briefing.');
    } finally {
      setBusy(false);
    }
  };
  const link = (itemKey: string) => `/${slug}/p/${projectKeys[itemKey.split('-')[0]] ?? itemKey.split('-')[0]}/board?issue=${itemKey}`;

  return (
    <div aria-live="polite">
      {!brief && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void run()}>
            <Sparkles size={14} /> {busy ? 'Reading your work…' : 'Brief me'}
          </Button>
          <p className="text-xs text-muted">A short read on your day, from your own work. It only reads; it never changes anything.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {brief && (
        <div className="space-y-3">
          <p className="text-sm">{brief.summary}</p>
          {brief.focus.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Suggested focus</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {brief.focus.map((f) => (
                  <li key={f.key}>
                    <Link to={link(f.key)} className="font-medium underline">
                      {f.key}
                    </Link>{' '}
                    {f.title} <span className="text-muted">— {f.why}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {brief.watchouts.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Watch out</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {brief.watchouts.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <p className="text-xs text-muted">
              Written by {brief.provider} at {new Date(brief.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Suggestions only: check them before acting.
            </p>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run()}>
              <Sparkles size={13} /> {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
