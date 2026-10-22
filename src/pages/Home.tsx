import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Button } from '@/components/ui';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { GettingStarted } from '@/components/GettingStarted';
import { Dashboard } from '@/components/Dashboard';

export function Home() {
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const canCreate = useCan('project.create');
  const [creating, setCreating] = useState(false);
  const me = data.members.find((m) => m.id === userId);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hi {me?.name.split(' ')[0]} 👋</h1>
          <p className="text-muted">{data.org.name} · {data.projects.length} projects · {data.members.length} people</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New project
          </Button>
        )}
      </header>

      <GettingStarted onCreateProject={() => setCreating(true)} />
      <Dashboard />
      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}
