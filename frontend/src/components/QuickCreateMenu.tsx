import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Receipt,
  Wallet,
  BookOpen,
  Building2,
  Users,
  Package,
} from 'lucide-react';
import type { Role } from '@/api/client';
import { cn } from '@/lib/utils';

interface QuickCreateAction {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: typeof FileText;
  allowedRoles: Role[];
  requiredModule?: string;
}

const QUICK_CREATE_ACTIONS: QuickCreateAction[] = [
  {
    id: 'invoice',
    label: 'Customer Invoice',
    description: 'Create draft or issue tax invoice',
    href: '/invoices',
    icon: FileText,
    requiredModule: 'RECEIVABLES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AR_SPECIALIST'],
  },
  {
    id: 'bill',
    label: 'Vendor Bill',
    description: 'Record supplier bill or PO',
    href: '/bills',
    icon: Receipt,
    requiredModule: 'PAYABLES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AP_SPECIALIST'],
  },
  {
    id: 'expense-claim',
    label: 'Expense Claim',
    description: 'Submit out-of-pocket reimbursement',
    href: '/expenses',
    icon: Wallet,
    requiredModule: 'EXPENSES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'EMPLOYEE'],
  },
  {
    id: 'journal',
    label: 'Manual Journal',
    description: 'Post double-entry GL adjustment',
    href: '/ledger',
    icon: BookOpen,
    allowedRoles: ['ADMIN', 'ACCOUNTANT'],
  },
  {
    id: 'bank-transfer',
    label: 'Bank Transfer / Rec',
    description: 'Move funds or import statement CSV',
    href: '/banking',
    icon: Building2,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER'],
  },
  {
    id: 'contact',
    label: 'Contact (Customer / Vendor)',
    description: 'Add contact with ABN & EFT details',
    href: '/contacts',
    icon: Users,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AR_SPECIALIST', 'AP_SPECIALIST'],
  },
  {
    id: 'item',
    label: 'Catalog Item / Service',
    description: 'Add coded SKU with default GL account',
    href: '/items',
    icon: Package,
    allowedRoles: ['ADMIN', 'ACCOUNTANT'],
  },
];

interface QuickCreateMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  role: Role | null;
  enabledModules?: string[];
}

export function QuickCreateMenu({
  open,
  onToggle,
  onClose,
  role,
  enabledModules,
}: QuickCreateMenuProps) {
  const navigate = useNavigate();

  const actions = QUICK_CREATE_ACTIONS.filter((a) => {
    if (role && !a.allowedRoles.includes(role)) return false;
    if (a.requiredModule && enabledModules && !enabledModules.includes(a.requiredModule)) {
      return false;
    }
    return true;
  });

  if (actions.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title="Quick Create"
        aria-label="Quick Create"
        className={cn(
          'inline-flex items-center justify-center gap-1 h-7 px-2 rounded border text-xs font-medium transition-colors',
          open
            ? 'bg-forest-700 text-white border-emerald-400/50'
            : 'bg-forest-900 hover:bg-forest-700 text-white border-emerald-500/30',
        )}
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden lg:inline">New</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded bg-obsidian-900 border border-white/15 shadow-2xl py-1 divide-y divide-white/[0.06]">
          <div className="px-3 py-1.5 bg-obsidian-950/50">
            <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
              Quick Create
            </p>
          </div>
          <div className="py-1">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(action.href);
                  }}
                  className="w-full px-3 py-2 min-h-[44px] sm:min-h-0 sm:py-1.5 text-left flex items-start gap-2.5 text-slate-200 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{action.label}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {action.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
