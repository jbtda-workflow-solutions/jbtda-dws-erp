import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export function Input({
  label,
  error,
  hint,
  mono = false,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-slate-700 tracking-tight"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={cn(
          'h-8 w-full rounded border px-2.5 text-xs text-slate-900',
          'placeholder:text-slate-400',
          'focus:outline-none focus:ring-1 focus:ring-forest-700 focus:border-forest-700',
          'transition-colors',
          mono && 'font-mono tabular-nums',
          error
            ? 'border-rose-400 bg-rose-50/40 focus:ring-rose-500 focus:border-rose-500'
            : 'border-slate-300 bg-white',
          props.disabled && 'opacity-60 cursor-not-allowed bg-slate-100',
          className,
        )}
      />
      {hint && !error && (
        <p className="text-[11px] text-slate-500">{hint}</p>
      )}
      {error && (
        <p className="text-[11px] text-rose-600 font-medium">{error}</p>
      )}
    </div>
  );
}
