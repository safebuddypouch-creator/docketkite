// @polsia:user-owned — bar that fills as counted team tasks are marked done.
'use client';

import { Progress } from '@/components/ui/progress';

export function completionPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const bounded = Math.min(Math.max(completed, 0), total);
  return Math.round((bounded / total) * 100);
}

export function CompletionProgress({
  completed,
  total,
  noun = 'team tasks',
}: {
  completed: number;
  total: number;
  noun?: string;
}) {
  const safeTotal = Math.max(total, 0);
  const safeCompleted = Math.min(Math.max(completed, 0), safeTotal || 0);
  const percent = completionPercent(safeCompleted, safeTotal);
  const done = safeTotal > 0 && safeCompleted === safeTotal;
  const summary = done
    ? `All ${noun} are done`
    : `${safeCompleted} of ${safeTotal} ${noun} complete`;

  return (
    <div className="grid min-w-44 gap-1.5" data-testid="completion-progress">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {summary}
      </p>
      <Progress value={percent} aria-label={summary} aria-valuetext={summary} />
    </div>
  );
}
