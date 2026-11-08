import { cn } from '@/lib/utils';

export interface PipelineStage<T extends string = string> {
  id: T;
  step?: string;
  label: string;
  count: number;
  amountCents?: number;
  tone?: 'default' | 'emerald' | 'amber' | 'rose';
}

interface PipelineRibbonProps<T extends string = string> {
  stages: PipelineStage<T>[];
  activeStageId: T;
  onSelectStage: (id: T) => void;
  className?: string;
}

function formatAUD(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

/**
 * Connected Horizontal Process Pipeline Ribbon (Corporate Precision Design System)
 * Displays the sequential workflow stages with live counts and AUD totals,
 * acting as both a visual process map and a 1-click filter.
 */
export function PipelineRibbon<T extends string = string>({
  stages,
  activeStageId,
  onSelectStage,
  className,
}: PipelineRibbonProps<T>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr divide-y sm:divide-y-0 divide-x divide-slate-200 border border-slate-200 bg-white rounded-md overflow-hidden',
        className,
      )}
    >
      {stages.map((stage, idx) => {
        const isActive = stage.id === activeStageId;
        const stepLabel = stage.step ?? `0${idx + 1}`;

        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onSelectStage(stage.id)}
            className={cn(
              'group relative flex flex-col justify-between px-3.5 py-2.5 text-left transition-colors focus:outline-none',
              isActive
                ? 'bg-forest-50/40'
                : 'hover:bg-slate-50/80',
            )}
          >
            {/* Active Bottom Accent Indicator */}
            <div
              className={cn(
                'absolute inset-x-0 bottom-0 h-0.5 transition-colors',
                isActive
                  ? 'bg-forest-900'
                  : 'bg-transparent group-hover:bg-slate-200',
              )}
            />

            <div className="flex items-center justify-between gap-2 w-full">
              <span
                className={cn(
                  'text-[11px] font-medium uppercase tracking-wider truncate',
                  isActive ? 'text-forest-900' : 'text-slate-500',
                )}
              >
                <span className="font-mono text-[10px] text-slate-400 mr-1.5">
                  {stepLabel}
                </span>
                {stage.label}
              </span>
              <span
                className={cn(
                  'font-mono text-[11px] px-1.5 py-0.2 rounded border tabular-nums shrink-0',
                  isActive
                    ? 'bg-forest-900 text-white border-forest-900'
                    : stage.tone === 'amber' && stage.count > 0
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : stage.tone === 'rose' && stage.count > 0
                        ? 'bg-rose-50 text-rose-900 border-rose-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200',
                )}
              >
                {stage.count}
              </span>
            </div>

            {stage.amountCents !== undefined && (
              <p
                className={cn(
                  'mt-1.5 font-numbers text-sm font-medium tabular-nums tracking-tight truncate',
                  stage.tone === 'rose' && stage.amountCents > 0
                    ? 'text-rose-700'
                    : stage.tone === 'emerald' && stage.amountCents > 0
                      ? 'text-emerald-800'
                      : 'text-slate-900',
                )}
              >
                {formatAUD(stage.amountCents)}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

