import { useEffect, useRef, type ComponentProps, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import type { Member } from '@/domain/types';

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-primary text-primary-fg hover:opacity-90',
    secondary: 'bg-surface border border-line hover:bg-surface-2',
    ghost: 'hover:bg-surface-2 text-muted hover:text-fg',
    danger: 'bg-danger text-white hover:opacity-90',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        styles[variant],
        className
      )}
    />
  );
}

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-2.5 text-sm text-fg placeholder:text-muted/70 focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, 'h-9', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(fieldBase, 'py-2 resize-y', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, 'h-9 pr-6', className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Avatar({ user, size = 24 }: { user?: Pick<Member, 'name' | 'color'>; size?: number }) {
  if (!user) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-muted"
        style={{ width: size, height: size }}
        title="Unassigned"
      >
        ?
      </span>
    );
  }
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: user.color, fontSize: size * 0.4 }}
      title={user.name}
    >
      {initials}
    </span>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-surface-2 border border-line', className)}
      style={color ? { color, borderColor: color + '55', background: color + '14' } : undefined}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn('w-full rounded-xl border border-line bg-surface shadow-card', width)}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

