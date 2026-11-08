import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'amber';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variantClasses = {
  primary:
    'bg-forest-900 text-white border border-forest-900 hover:bg-forest-700 hover:border-forest-700 focus-visible:ring-forest-500',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 focus-visible:ring-slate-400',
  danger:
    'bg-rose-700 text-white border border-rose-700 hover:bg-rose-800 focus-visible:ring-rose-500',
  amber:
    'bg-amber-700 text-white border border-amber-700 hover:bg-amber-800 focus-visible:ring-amber-500',
};

const sizeClasses = {
  xs: 'h-7 px-2.5 text-[11px] rounded',
  sm: 'h-8 px-3 text-xs rounded',
  md: 'h-9 px-3.5 text-xs rounded',
  lg: 'h-10 px-5 text-sm rounded',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled ?? loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium tracking-tight transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {loading && (
        <svg
          className="animate-spin h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
