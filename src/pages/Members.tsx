import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { api, type InviteView } from '@/data/apiRepository';
import { ROLE_LABEL } from '@/domain/permissions';
import { formatDate } from '@/domain/selectors';
import type { Role } from '@/domain/types';
import { BACKEND, useApp, useCan, useRole } from '@/store/app';
import { Avatar, Badge, Button, Field, Input, Select } from '@/components/ui';

const ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including billing and removing owners.',
  admin: 'Manage projects, people, automation and forms.',
  member: 'Create and edit work.',
  guest: 'Comment and approve only.',
};

export function Members() {
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const { updateMemberRole, removeMember, notify } = useApp();
  const canManage = useCan('member.manage');
  const myRole = useRole();
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = async () => {
    if (BACKEND !== 'api' || !canManage) return;
    try {
      setInvites((await api.listInvites(data.org.id)).invites);
    } catch {
      /* the list is optional */
    }
  };
  useEffect(() => {
    void loadInvites();
  }, [data.org.id, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLink(null);
    try {
      const out = await api.createInvite(data.org.id, email, role);
      setLink(out.link);
      setEmailed(out.emailed);
      setEmail('');
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invitation.');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Link copied');
    } catch {
      notify('Could not copy. Select the link and copy it by hand.');
    }
  };

  const roleOptions = ROLES.filter((r) => r !== 'owner' || myRole === 'owner');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">People</h1>
        <p className="text-muted">
          {data.members.length} in {data.org.name}
        </p>
      </header>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {data.members.map((m) => {
          const isMe = m.id === userId;
          const locked = m.role === 'owner' && myRole !== 'owner';
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar user={m} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {m.name} {isMe && <Badge>You</Badge>}
                </div>
                <div className="truncate text-xs text-muted">{m.email}</div>
              </div>
              {canManage && !locked ? (
                <Select aria-label={`Role of ${m.name}`} className="w-32" value={m.role} onChange={(e) => void updateMemberRole(m.id, e.target.value as Role)}>
                  {(roleOptions.includes(m.role) ? roleOptions : [m.role, ...roleOptions]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{ROLE_LABEL[m.role]}</Badge>
              )}
              {(isMe || (canManage && !locked)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={isMe ? 'Leave organization' : `Remove ${m.name}`}
                  onClick={() => confirm(isMe ? `Leave ${data.org.name}?` : `Remove ${m.name} from ${data.org.name}? Their open work becomes unassigned.`) && void removeMember(m.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && BACKEND === 'api' && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <UserPlus size={16} /> Invite someone
          </h2>
          <p className="mb-3 text-sm text-muted">They get a link to join. If email isn't set up on this server, copy the link and send it yourself.</p>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <Field label="Email">
              <Input required type="email" className="w-64" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Role" hint={ROLE_HELP[role]}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-36">
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              Create invite link
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
          {link && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3">
              <span className="w-full text-xs text-muted">{emailed ? 'The invitation was emailed. You can also share this link:' : 'Email is not configured, so send this link yourself:'}</span>
              <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
              <Button size="sm" onClick={() => void copy(link)}>
                <Copy size={12} /> Copy
              </Button>
            </div>
          )}

          {invites.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Pending invitations</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <Badge>{ROLE_LABEL[i.role]}</Badge>
                    <span className="text-xs text-muted">expires {formatDate(i.expiresAt)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Revoke invitation for ${i.email}`}
                      onClick={async () => {
                        await api.revokeInvite(data.org.id, i.id);
                        await loadInvites();
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {BACKEND === 'api' && canManage && (
        <p className="text-sm text-muted">
          Plan, webhooks, audit log, data export and deleting the organization are in{' '}
          <Link className="underline" to={`/${data.org.slug}/settings?tab=organization`}>
            Settings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
