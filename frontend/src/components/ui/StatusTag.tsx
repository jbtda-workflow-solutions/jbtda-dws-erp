import { cn } from '@/lib/utils';

export type StatusTagTone =
  | 'emerald'
  | 'amber'
  | 'slate'
  | 'draft'
  | 'rose'
  | 'forest'
  | 'posted'
  | 'pending'
  | 'info'
  | 'locked'
  | 'neutral'
  | 'danger'
  | 'cyan';

export interface StatusTagProps {
  label?: string;
  tone?: StatusTagTone;
  variant?: StatusTagTone;
  mono?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const toneClasses: Record<
  'emerald' | 'amber' | 'slate' | 'draft' | 'rose' | 'forest',
  { wrapper: string; dot: string }
> = {
  emerald: {
    wrapper: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  amber: {
    wrapper: 'bg-amber-50/80 border-amber-200 text-amber-900',
    dot: 'bg-amber-600',
  },
  slate: {
    wrapper: 'bg-slate-100/80 border-slate-300 text-slate-800',
    dot: 'bg-slate-600',
  },
  draft: {
    wrapper: 'bg-slate-50 border-slate-200 text-slate-600',
    dot: 'bg-slate-400',
  },
  rose: {
    wrapper: 'bg-rose-50/80 border-rose-200 text-rose-900',
    dot: 'bg-rose-600',
  },
  forest: {
    wrapper: 'bg-forest-50 border-forest-200 text-forest-900',
    dot: 'bg-forest-700',
  },
};

function normalizeTone(
  input: StatusTagTone,
): 'emerald' | 'amber' | 'slate' | 'draft' | 'rose' | 'forest' {
  switch (input) {
    case 'emerald':
    case 'posted':
      return 'emerald';
    case 'amber':
    case 'pending':
      return 'amber';
    case 'slate':
    case 'info':
    case 'cyan':
      return 'slate';
    case 'rose':
    case 'danger':
      return 'rose';
    case 'forest':
    case 'locked':
      return 'forest';
    case 'draft':
    case 'neutral':
    default:
      return 'draft';
  }
}

/**
 * Maps standard ERP statuses & roles to semantic tones automatically.
 */
export function resolveStatusTone(
  status: string,
): 'emerald' | 'amber' | 'slate' | 'draft' | 'rose' | 'forest' {
  const s = status.toUpperCase();
  if (
    [
      'PAID',
      'POSTED',
      'APPROVED',
      'ACCEPTED',
      'INVOICED',
      'BILLED',
      'RECONCILED',
      'ACTIVE',
      'BALANCED',
      'ADMIN',
    ].includes(s)
  ) {
    return 'emerald';
  }
  if (
    [
      'PENDING_APPROVAL',
      'SUBMITTED',
      'PARTIALLY_PAID',
      'SENT',
      'ACCOUNTANT',
      'MANAGER',
    ].includes(s)
  ) {
    return 'amber';
  }
  if (
    [
      'ISSUED',
      'AWAITING_PAYMENT',
      'OPEN',
      'AR_SPECIALIST',
      'AP_SPECIALIST',
    ].includes(s)
  ) {
    return 'slate';
  }
  if (
    [
      'OVERDUE',
      'VOID',
      'REJECTED',
      'DECLINED',
      'EXPIRED',
      'CANCELLED',
      'IMBALANCED',
      'INACTIVE',
    ].includes(s)
  ) {
    return 'rose';
  }
  if (['SYSTEM', 'PROTECTED', 'LOCKED', 'AUDITOR'].includes(s)) {
    return 'forest';
  }
  return 'draft';
}

/**
 * Squared Technical Status Tag (4px corner radius, 1px border, 6px dot)
 */
export function StatusTag({
  label,
  tone,
  variant,
  mono = false,
  className,
  children,
}: StatusTagProps) {
  const displayLabel =
    label ?? (typeof children === 'string' ? children : String(children ?? ''));
  const explicitTone = tone ?? variant;
  const resolved = explicitTone
    ? normalizeTone(explicitTone)
    : resolveStatusTone(displayLabel);
  const styles = toneClasses[resolved];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border leading-tight whitespace-nowrap',
        mono && 'font-mono',
        styles.wrapper,
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', styles.dot)} />
      {children ?? label}
    </span>
  );
}
