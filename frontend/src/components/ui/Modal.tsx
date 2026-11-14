import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Size preset or custom max width class */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | 'full';
  /** Optional custom class override for max-w */
  maxWidth?: string;
}

const SIZE_MAP: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg md:max-w-xl',
  xl: 'max-w-xl md:max-w-2xl',
  '2xl': 'max-w-2xl md:max-w-3xl',
  '3xl': 'max-w-3xl md:max-w-4xl lg:max-w-4xl',
  '4xl': 'max-w-4xl md:max-w-5xl lg:max-w-5xl',
  '5xl': 'max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-6xl',
  '6xl': 'max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-7xl',
  full: 'max-w-[95vw] lg:max-w-[92vw]',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size,
  maxWidth,
}: ModalProps) {
  if (!open) return null;

  const widthClass = maxWidth ?? (size ? SIZE_MAP[size] : 'max-w-md');

  return createPortal(
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 !mt-0 bg-obsidian-950/60 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — Crisp 6px rounded-md geometry with 1px structural border */}
      <div
        className={cn(
          'relative w-full rounded-md bg-white border border-slate-200 shadow-2xl flex flex-col max-h-[92vh]',
          widthClass,
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
    </div>,
    document.body,
  );
}
