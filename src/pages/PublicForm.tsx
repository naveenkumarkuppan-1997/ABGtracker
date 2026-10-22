import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { getPublicForm, submitPublicForm } from '@/store/app';
import type { FormField, PublicForm as PublicFormData } from '@/domain/types';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/data/apiRepository';
import { fileProblem, formatBytes } from '@/domain/attachments';
import { PUBLIC_MAX_FILES } from '@/domain/forms';

/** A file question: pick up to a few files; they are checked here before anything is sent. */
function FileQuestion({ label, required, files, limitBytes, blocked, onChange }: { label: string; required: boolean; files: File[]; limitBytes: number; blocked?: string[]; onChange: (f: File[]) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Field label={label + (required ? ' *' : '')} hint={`Up to ${PUBLIC_MAX_FILES} files, ${formatBytes(limitBytes)} each.`}>
      <input
        type="file"
        multiple
        aria-label={label}
        className="block w-full text-sm"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          const limits = { maxFileBytes: limitBytes, maxFilesPerIssue: 99, orgQuotaBytes: Infinity };
          const bad = picked.length > PUBLIC_MAX_FILES ? `You can send up to ${PUBLIC_MAX_FILES} files.` : picked.map((f) => fileProblem(f.name, f.size, limits, blocked)).find(Boolean) ?? null;
          setProblem(bad);
          if (bad) e.target.value = '';
          onChange(bad ? [] : picked);
        }}
      />
      {problem && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {problem}
        </span>
      )}
      {files.length > 0 && <span className="mt-1 block text-xs text-muted">{files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')}</span>}
    </Field>
  );
}

/** One question, rendered for its kind. Shared with the form editor's preview. */
export function Question({ field, value, onChange, disabled }: { field: FormField; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const label = field.label + (field.required ? ' *' : '');
  const common = { disabled, required: field.required, 'aria-label': field.label };
  if (field.kind === 'file') {
    // In the editor preview only; the live form uses FileQuestion above.
    return (
      <Field label={label}>
        <input type="file" disabled aria-label={field.label} className="block w-full text-sm" />
      </Field>
    );
  }
  return (
    <Field label={label}>
      {field.kind === 'long' ? (
        <Textarea {...common} rows={4} maxLength={5000} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === 'select' ? (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.options ?? []).filter(Boolean).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      ) : (
        <Input
          {...common}
          type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : 'text'}
          step={field.kind === 'number' ? 'any' : undefined}
          maxLength={field.kind === 'short' ? 300 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Public page: no sign-in, no access to anything but this form. */
export function PublicForm() {
  const { orgSlug = '', formSlug = '' } = useParams();
  const [data, setData] = useState<PublicFormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState(''); // honeypot: hidden from people, filled by bots
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadNotes, setUploadNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ bytes: number; blocked?: string[] }>({ bytes: 10 * 1024 * 1024 });

  useEffect(() => {
    api
      .config()
      .then((c) => c.attachments.enabled && setLimit({ bytes: c.attachments.publicMaxFileBytes ?? 10 * 1024 * 1024, blocked: c.attachments.blockedExtensions }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    getPublicForm(orgSlug, formSlug)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'This form is not available.'));
    return () => {
      live = false;
    };
  }, [orgSlug, formSlug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fileQ = data?.form.fields.find((f) => f.kind === 'file');
    if (fileQ?.required && files.length === 0) return setError(`“${fileQ.label}” needs at least one file.`);
    setBusy(true);
    setError(null);
    try {
      const r = await submitPublicForm(orgSlug, formSlug, answers, { name, email }, trap);
      // The request is in. Now send the files, one at a time, with the one-time ticket we were given.
      const notes: string[] = [];
      if (r.upload && files.length) {
        const batch = files.slice(0, r.upload.maxFiles);
        for (const [i, f] of batch.entries()) {
          setProgress(`Sending file ${i + 1} of ${batch.length}…`);
          try {
            await api.uploadPublic(r.upload.token, f);
          } catch (err) {
            notes.push(`“${f.name}” could not be sent: ${err instanceof Error ? err.message : 'upload failed'}`);
          }
        }
      }
      setProgress(null);
      setUploadNotes(notes);
      setDone(r.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-bg px-4 py-10">
      <div className="mx-auto max-w-xl">
        {!data && !error && <p className="text-center text-muted">Loading…</p>}
        {!data && error && (
          <div className="rounded-xl border border-line bg-surface p-8 text-center">
            <h1 className="text-lg font-semibold">Form unavailable</h1>
            <p className="mt-1 text-sm text-muted">{error}</p>
          </div>
        )}
        {data && done && (
          <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-card">
            <CheckCircle2 size={36} className="mx-auto text-[#2f9e6b]" />
            <h1 className="mt-3 text-xl font-semibold">Thanks, we got it!</h1>
            <p className="mt-1 text-sm text-muted">
              Your request was sent to {data.orgName}
              {done.endsWith('-0') ? '.' : <> as <b className="text-fg">{done}</b>.</>} We'll follow up at {email}.
            </p>
            {uploadNotes.length > 0 && (
              <div role="alert" className="mt-3 rounded-md bg-danger/10 p-3 text-left text-sm text-danger">
                <p className="font-medium">Your request was received, but some files did not arrive:</p>
                <ul className="mt-1 list-disc pl-5">
                  {uploadNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">Please reply to our confirmation with those files instead.</p>
              </div>
            )}
            <Button
              className="mt-5"
              onClick={() => {
                setDone(null);
                setAnswers({});
                setFiles([]);
                setUploadNotes([]);
              }}
            >
              Send another
            </Button>
          </div>
        )}
        {data && !done && (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-card">
            <header>
              <p className="text-xs text-muted">
                {data.orgName} · {data.projectName}
              </p>
              <h1 className="text-xl font-semibold">{data.form.name}</h1>
              {data.form.description && <p className="mt-1 text-sm text-muted">{data.form.description}</p>}
            </header>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name *">
                <Input required aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </Field>
              <Field label="Your email *">
                <Input required aria-label="Your email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
              </Field>
            </div>

            {data.form.fields.map((f) =>
              f.kind === 'file' ? (
                <FileQuestion key={f.id} label={f.label} required={f.required} files={files} limitBytes={limit.bytes} blocked={limit.blocked} onChange={setFiles} />
              ) : (
                <Question key={f.id} field={f} value={answers[f.id] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))} />
              )
            )}

            {/* Honeypot: invisible to people and assistive tech, tempting to bots. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>
                Leave this empty
                <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
              </label>
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? (progress ?? 'Sending…') : 'Submit request'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-muted">Powered by ABG Tracker</p>
      </div>
    </div>
  );
}
