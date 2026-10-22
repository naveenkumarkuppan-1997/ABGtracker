import { useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '@/data/apiRepository';
import type { Project } from '@/domain/types';
import { BACKEND, useApp, useCan } from '@/store/app';
import { Button } from './ui';

/** "Import" next to the board/list tools: bring in a spreadsheet saved as CSV (from Excel, Jira, Asana…). */
export function ImportCsv({ project }: { project: Project }) {
  const canCreate = useCan('issue.create');
  const reload = useApp((s) => s.reloadOrg);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (BACKEND !== 'api' || !canCreate) return null;

  const close = () => {
    setOpen(false);
    setResult(null);
    setError(null);
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Upload size={13} /> Import
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={close}>
          <div role="dialog" aria-label="Import from a spreadsheet" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-base font-semibold">Import into {project.name}</h2>
            <p className="text-sm text-muted">
              Choose a <b>.csv</b> file. The first row names the columns. Only <b>Title</b> is required; the others are used when present:
              Description, Type, Status, Priority (critical/high/medium/low), Assignee (email or name), Labels, Estimate, Start, Due (2026-12-31). Up to 500 items at a time.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              disabled={busy}
              className="block w-full text-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError(null);
                setResult(null);
                try {
                  setResult(await api.importCsv(project.id, await file.text()));
                  await reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not import this file.');
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
            {busy && <p className="text-sm text-muted">Importing…</p>}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            {result && (
              <div role="status" className="space-y-1 text-sm">
                <p>
                  <b>{result.created}</b> item{result.created === 1 ? '' : 's'} created.
                  {result.skipped.length > 0 && ` ${result.skipped.length} skipped:`}
                </p>
                {result.skipped.length > 0 && (
                  <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted">
                    {result.skipped.slice(0, 50).map((s) => (
                      <li key={s.row}>
                        Row {s.row}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={close}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
