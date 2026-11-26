// @polsia:user-owned — the completion bar reports open work and a finished set.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompletionProgress, completionPercent } from '@/components/custom/completion-progress';

describe('completion progress', () => {
  it('stays empty when no tasks are done', () => {
    expect(completionPercent(0, 4)).toBe(0);
    const html = renderToStaticMarkup(
      createElement(CompletionProgress, { completed: 0, total: 4 }),
    );
    expect(html).toContain('0 of 4 team tasks complete');
    expect(html).not.toContain('All team tasks are done');
  });

  it('fills partway and names the finished state when every task is done', () => {
    expect(completionPercent(1, 4)).toBe(25);
    expect(completionPercent(4, 4)).toBe(100);
    const html = renderToStaticMarkup(
      createElement(CompletionProgress, { completed: 4, total: 4 }),
    );
    expect(html).toContain('All team tasks are done');
  });
});
