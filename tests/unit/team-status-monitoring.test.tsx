// @polsia:user-owned — public status change rows keep permit identity on a real line.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamStatusMonitoring } from '@/components/custom/team-status-monitoring';
import { apiFetch } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
let root: Root | null = null;

const sourceUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

const team = {
  id: 'team-tampa',
  name: 'City of Tampa desk',
  joinCode: 'TAMPA1',
  role: 'owner',
  paymentStatus: 'active' as const,
  accessActive: true,
  accessMode: 'paid_subscription' as const,
  trialStartedAt: null,
  trialEndsAt: null,
  trialStatus: 'not_started' as const,
};

const detection = {
  id: 'change-1',
  permitId: 'permit-1',
  permitNumber: 'BLD-26-0520668-5',
  projectName: 'Lynnwood test remodel',
  address: 'test 25604 S Lynnwood Ave T33611',
  permitType: 'Building',
  previousStatus: 'In Review',
  newStatus: 'Issued',
  detectedAt: '2026-11-25T17:35:00.000Z',
  observedAt: '2026-11-25T17:30:00.000Z',
  sourceUrl,
  targetedRole: 'unassigned' as const,
  textDeliveryStatus: 'unverified' as const,
  textDeliveryMessage:
    'No SMS provider is installed or configured, so delivery to the project manager is unverified.',
  checklistMatchStatus: 'unverified' as const,
  checklistMatchMessage:
    'This status observation did not include a City notice; a notice-based checklist match is unverified.',
};

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.resetAllMocks();
});

describe('public status change row', () => {
  it('keeps the permit identity in a flexible column and the alert note out of the side rail', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/teams')) return { items: [team] };
      if (path.startsWith('/api/permit-status-detections')) return { items: [detection] };
      throw new Error(`Unexpected request ${path}`);
    });

    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root?.render(<TeamStatusMonitoring initialTeamId="team-tampa" />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector('[data-testid="status-change-change-1"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain('sm:grid-cols-[minmax(12rem,1fr)_auto]');
    expect(card?.textContent).toContain('BLD-26-0520668-5 · Building');
    expect(card?.textContent).toContain('test 25604 S Lynnwood Ave T33611');
    expect(card?.textContent).toContain('Open official City record');
    expect(card?.textContent).toContain('View status history');

    const official = card?.querySelector(`a[href="${sourceUrl}"]`);
    expect(official?.className ?? '').not.toMatch(/\binline-block\b|\bbreak-all\b|\bbreak-words\b/);
    expect(official?.className ?? '').toContain('w-fit');

    const note = Array.from(card?.querySelectorAll('p') ?? []).find((paragraph) =>
      paragraph.textContent?.includes('Target:'),
    );
    expect(note?.className).toContain('sm:col-span-2');
    expect(note?.className ?? '').not.toContain('w-full');
    expect(note?.parentElement).toBe(card);
  });
});
