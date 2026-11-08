import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  /** Optional lifecycle or approval bar rendered directly below the header */
  statusBar?: ReactNode;
  /** Optional sticky footer bar for contextual actions */
  footer?: ReactNode;
  children: ReactNode;
  width?: 'md' | 'lg' | 'xl' | '2xl';
}

const widthClasses = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

/**
 * Right-Hand Slide-Over Inspector Drawer (Corporate Precision Design System)
 * Used for inspecting documents, GL journals, contacts, and audit logs in context.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  statusBar,
  footer,
  children,
  width = 'xl',
}: DrawerProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Subtle backdrop */}
      <div
        className="fixed inset-0 bg-obsidian-950/35 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Docked Right-Hand Panel */}
      <div
        className={cn(
          'relative z-10 w-full bg-white border-l border-slate-200 shadow-2xl flex flex-col h-full',
          widthClasses[width],
        )}
      >
        {/* Sticky Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-medium tracking-tight text-slate-900 truncate">
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close inspector drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Optional Lifecycle / Approval Bar */}
        {statusBar && (
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 shrink-0">
            {statusBar}
          </div>
        )}

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {children}
        </div>

        {/* Optional Sticky Action Footer */}
        {footer && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

