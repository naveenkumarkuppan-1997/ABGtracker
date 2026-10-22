import { useCallback, useEffect, useState } from 'react';
import { api, type BillingView } from '@/data/apiRepository';
import { formatDate } from '@/domain/selectors';
import { useApp } from '@/store/app';
import { Button, cn } from './ui';

/** Plan, what is used, and (for owners) a way to change it. In demo mode it says plainly that no money moves. */
export function BillingSection({ orgId }: { orgId: string }) {
  const notify = useApp((s) => s.notify);
  const [view, setView] = useState<BillingView | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.billing(orgId).then(setView).catch(() => undefined), [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!view) return null;

  const change = async (plan: string) => {
    const label = view.plans[plan as keyof typeof view.plans].label;
    if (!confirm(`Switch to the ${label} plan?${view.mode === 'mock' ? ' (Demo: nobody is charged.)' : ''}`)) return;
    setBusy(true);
    try {
      const r = await api.changePlan(orgId, plan);
      if (r.redirectTo) window.location.assign(r.redirectTo);
      notify(`You are now on the ${label} plan.`);
      await load(); // this section reads its own data, so nothing else needs to be reloaded
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not change the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Plan and billing</h2>
      {view.mode === 'mock' && (
        <p role="note" className="rounded-md bg-accent/10 p-2 text-xs text-accent-text">
          Demo billing: plan changes work, but no payment is taken and invoices below are pretend. Real payments are connected when the product goes live.
        </p>
      )}
      {view.mode === 'none' && <p className="text-sm text-muted">Plan changes are not available on this server yet. Contact your administrator.</p>}
      <p className="text-sm text-muted">
        Using <b className="text-fg">{view.usage.people}</b> {view.usage.pendingInvites > 0 && `(+${view.usage.pendingInvites} invited) `}of {view.plans[view.plan].people} people and <b className="text-fg">{view.usage.projects}</b> of {view.plans[view.plan].projects} projects.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(view.plans) as (keyof typeof view.plans)[]).map((p) => {
          const plan = view.plans[p];
          const current = p === view.plan;
          return (
            <div key={p} className={cn('rounded-lg border p-3 text-sm', current ? 'border-accent bg-accent/5' : 'border-line')}>
              <p className="font-semibold">{plan.label}</p>
              <p className="text-lg font-semibold">{plan.priceUsdPerMonth === 0 ? 'Free' : `$${plan.priceUsdPerMonth}/mo`}</p>
              <p className="text-xs text-muted">
                Up to {plan.people} people, {plan.projects} projects
              </p>
              {current ? (
                <p className="mt-2 text-xs font-medium text-accent-text">Current plan</p>
              ) : (
                view.canChange && (
                  <Button size="sm" className="mt-2" disabled={busy} onClick={() => void change(p)}>
                    Switch to {plan.label}
                  </Button>
                )
              )}
            </div>
          );
        })}
      </div>
      {view.invoices.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Invoices</h3>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm" aria-label="Invoices">
            {view.invoices.map((i) => (
              <li key={i.id} className="flex justify-between px-3 py-1.5">
                <span>
                  {formatDate(i.at)} · {view.plans[i.plan].label}
                  {i.mock && <span className="ml-2 text-xs text-muted">(pretend)</span>}
                </span>
                <span>${i.amountUsd}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
