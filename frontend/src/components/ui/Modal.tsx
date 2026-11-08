import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Max width class, e.g. 'max-w-md', 'max-w-2xl', 'max-w-4xl' */
  maxWidth?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-md',
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian-950/60 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — Crisp 6px rounded-md geometry with 1px structural border */}
      <div
        className={cn(
          'relative w-full rounded-md bg-white border border-slate-200 shadow-2xl flex flex-col max-h-[90vh]',
          maxWidth,
        )}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
          <div>
            <h2
              id="modal-title"
              className="text-sm font-medium tracking-tight text-slate-900"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-slate-500">
                {description}
              </p>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
