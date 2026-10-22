import {
  Bookmark, Bug, Calendar, Check, CornerDownRight, Flag, Heart, Lightbulb, Mail, Megaphone, Package, Palette, Phone, Rocket, ShieldCheck, ShoppingCart, Star, Truck, Users, Wallet, Wrench, Zap, FileText,
  ChevronsUp, ChevronUp, Equal, ChevronDown, type LucideIcon,
} from 'lucide-react';
import { PRIORITIES } from '@/domain/templates';
import type { IssueType, Priority } from '@/domain/types';

export const TYPE_ICON_COMPONENTS: Record<string, LucideIcon> = {
  zap: Zap,
  bookmark: Bookmark,
  check: Check,
  bug: Bug,
  branch: CornerDownRight,
  flag: Flag,
  shield: ShieldCheck,
  star: Star,
  lightbulb: Lightbulb,
  rocket: Rocket,
  wrench: Wrench,
  megaphone: Megaphone,
  users: Users,
  phone: Phone,
  mail: Mail,
  file: FileText,
  package: Package,
  truck: Truck,
  wallet: Wallet,
  cart: ShoppingCart,
  calendar: Calendar,
  heart: Heart,
  palette: Palette,
};
const TYPE_ICONS = TYPE_ICON_COMPONENTS;

export function TypeIcon({ type, size = 16 }: { type?: IssueType; size?: number }) {
  const Icon = (type && TYPE_ICONS[type.icon]) || Check;
  const color = type?.color ?? '#7b8794';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded"
      style={{ width: size + 4, height: size + 4, background: color }}
      title={type?.name}
    >
      <Icon size={size - 4} color="#fff" strokeWidth={2.5} />
    </span>
  );
}

const PRIORITY_ICONS: Record<Priority, LucideIcon> = {
  critical: ChevronsUp,
  high: ChevronUp,
  medium: Equal,
  low: ChevronDown,
};

export function PriorityIcon({ priority, size = 16 }: { priority: Priority; size?: number }) {
  const Icon = PRIORITY_ICONS[priority];
  const meta = PRIORITIES.find((p) => p.id === priority)!;
  return (
    <span title={`${meta.label} priority`} className="inline-flex">
      <Icon size={size} color={meta.color} strokeWidth={2.5} />
    </span>
  );
}
