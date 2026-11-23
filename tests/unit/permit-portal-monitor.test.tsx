// @polsia:user-owned — saved watcher health load failure presentation.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermitPortalMonitor } from '@/components/custom/permit-portal-monitor';
import { apiFetch } from '@/lib/api-client';
import {
  PermitPortalCheckList,
  type PermitPortalCheckItem,
  type PermitPortalMonitoringState,
} from '@/lib/contracts/permit-portal-check';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
let root: Root | null = null;

const savedAt = '2026-10-31T10:00:00.000Z';
const tampaUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

function createCheck(
  result: PermitPortalCheckItem['result'],
  checkedAt: string,
  status: string | null,
  message: string | null,
  sourceFetchedAt = result === 'checked' ? checkedAt : null,
): PermitPortalCheckItem {
  return {
    id: `check-${result}-${checkedAt}`,
    permitId: 'permit-1',
    permitNumber: '2026-010101',
    sourceUrl: tampaUrl,
    status,
    result,
    message,
    checkedAt,
    sourceFetchedAt,
    monitoringStatus: result === 'checked' ? status : null,
    monitoringAgreement: result === 'checked' ? 'matches_portal' : 'not_verified',
    redlineStatus: null,
    redlineResult: 'not_connected',
    redlineMessage: 'No Redline source is connected to this workspace for comparison.',
  };
}

function history(
  checks: PermitPortalCheckItem[],
  monitoring: PermitPortalMonitoringState,
  canRetry = true,
) {
  const verified = checks.find(
    (check) => check.result === 'checked' && Boolean(check.status?.trim()) && Boolean(check.sourceUrl),
  );
  return PermitPortalCheckList.parse({
    items: checks,
    monitoring,
    latestVerified: verified
      ? {
          permitNumber: verified.permitNumber,
          status: verified.status ?? '',
          sourceUrl: verified.sourceUrl ?? '',
          checkedAt: verified.checkedAt,
          sourceFetchedAt: verified.sourceFetchedAt ?? verified.checkedAt,
        }
      : null,
    canRetry,
  });
}

async function renderMonitor({
  retryOnly = false,
  archived = false,
  permitNumber = '2026-010101',
  portalUrl = tampaUrl,
}: {
  retryOnly?: boolean;
  archived?: boolean;
  permitNumber?: string;
  portalUrl?: string;
} = {}) {
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PermitPortalMonitor
        permitId="permit-1"
        permitNumber={permitNumber}
        portalUrl={portalUrl}
        teamId="team-1"
        archived={archived}
        retryOnly={retryOnly}
      />,
    );
    await Promise.resolve();
  });
  return container;
}

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.resetAllMocks();
});

describe('permit watcher health load state', () => {
  it('shows unavailable instead of a success timestamp when saved health fails to load', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    apiFetchMock.mockImplementation(async () => {
      throw new Error('saved outcomes unavailable');
    });
    const container = document.createElement('div');
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PermitPortalMonitor
          permitId="permit-1"
          permitNumber="2026-010101"
          portalUrl="https://permits.sanjoseca.gov/search/"
          teamId="team-1"
          archived={false}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'Watcher health unavailable. Saved outcomes could not be loaded.',
    );
    expect(container.textContent).not.toContain('No successful checks yet');
    expect(container.textContent).not.toContain(
      'No successful City of Tampa result has been verified yet.',
    );
    expect(container.textContent).not.toContain('No interruption recorded');
    expect(container.textContent).not.toContain('Loading saved watcher health');
  });

  it('does not show Retry check when the latest saved outcome succeeded', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    apiFetchMock.mockResolvedValue(
      history([createCheck('checked', savedAt, 'Technical Review', null)], {
        lastSuccessfulPortalCheckAt: savedAt,
        interruptedAt: null,
        reason: null,
      }),
    );
    const container = document.createElement('div');
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PermitPortalMonitor
          permitId="permit-1"
          permitNumber="2026-010101"
          portalUrl={tampaUrl}
          teamId="team-1"
          archived={false}
          retryOnly
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Technical Review');
    expect(container.textContent).toContain('Verified public City of Tampa result · Record Status');
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(savedAt);
    expect(container.textContent).not.toContain('Retry check');
  });

  it.each(['unverified', 'unavailable'] as const)(
    'shows Retry check for a latest saved %s outcome',
    async (result) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const reason = 'The public City record could not be verified.';
      apiFetchMock.mockResolvedValue(
        history([createCheck(result, savedAt, null, reason)], {
          lastSuccessfulPortalCheckAt: null,
          interruptedAt: savedAt,
          reason,
        }),
      );

      const container = await renderMonitor({ retryOnly: true });

      expect(container.textContent).toContain('Retry check');
      expect(container.textContent).toContain(reason);
    },
  );

  it('does not show Retry check to a non-owner when the latest check failed', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const reason = 'The public City record could not be verified.';
    apiFetchMock.mockResolvedValue(
      history(
        [createCheck('unavailable', savedAt, null, reason)],
        { lastSuccessfulPortalCheckAt: null, interruptedAt: savedAt, reason },
        false,
      ),
    );

    const container = await renderMonitor({ retryOnly: true });

    expect(container.textContent).toContain(reason);
    expect(container.textContent).not.toContain('Retry check');
  });

  it('shows the saved successful status and time after a retry recovers', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const interrupted = history(
      [createCheck('unavailable', savedAt, null, 'The City record could not be read.')],
      {
        lastSuccessfulPortalCheckAt: null,
        interruptedAt: savedAt,
        reason: 'The City record could not be read.',
      },
    );
    const recovered = history(
      [createCheck('checked', '2026-10-31T10:05:00.000Z', 'Issued', null)],
      {
        lastSuccessfulPortalCheckAt: '2026-10-31T10:05:00.000Z',
        interruptedAt: null,
        reason: null,
      },
    );
    apiFetchMock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        return {
          check: recovered.items[0],
          monitoring: recovered.monitoring,
        } as never;
      }
      return (apiFetchMock.mock.calls.filter((call) => call[1]?.method !== 'POST').length > 1
        ? recovered
        : interrupted) as never;
    });
    const container = await renderMonitor({ retryOnly: true });
    expect(container.textContent).toContain('Retry check');
    expect(container.textContent).toContain('The City record could not be read.');

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Issued');
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-10-31T10:05:00.000Z',
    );
    expect(container.textContent).not.toContain('Retry check');
  });

  it.each([false, true])(
    'keeps the last successful public reading after an unavailable attempt in %s context',
    async (retryOnly) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const successful = createCheck('checked', savedAt, 'Awaiting Client Reply', null);
    const failedAt = '2026-10-31T10:05:00.000Z';
    const unavailable = createCheck(
      'unavailable',
      failedAt,
      null,
      'The public City record could not be read.',
    );
    apiFetchMock.mockResolvedValue(
      history([unavailable, successful], {
        lastSuccessfulPortalCheckAt: savedAt,
        interruptedAt: failedAt,
        reason: unavailable.message,
      }),
    );

    const container = await renderMonitor({ retryOnly });
    const summary = container.querySelector('[aria-label="Last verified City of Tampa portal result"]');

    expect(summary?.textContent).toContain('Last successful public City of Tampa result · Record Status');
    expect(summary?.textContent).toContain('Awaiting Client Reply');
    expect(summary?.textContent).toContain('last successful public reading');
    expect(summary?.querySelector('time')?.getAttribute('dateTime')).toBe(savedAt);
    expect(summary?.querySelector('a')?.getAttribute('href')).toBe(tampaUrl);
    expect(container.textContent).toContain('The public City record could not be read.');
    expect(
      container
        .querySelector('[aria-label="Latest City of Tampa monitoring attempt"]')
        ?.textContent,
    ).toContain('Unavailable');
    expect(container.textContent).toContain(retryOnly ? 'Retry check' : 'Run public check');
    },
  );

  it('shows a later unverified attempt separately from an older verified Complete status', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const checkedAt = '2026-10-31T10:05:00.000Z';
    const readAt = '2026-10-31T10:04:00.000Z';
    const reason = 'The public page did not show a readable public Record Status field.';
    const unverified = createCheck('unverified', checkedAt, null, reason, readAt);
    const verified = createCheck('checked', savedAt, 'Complete', null);
    apiFetchMock.mockResolvedValue(
      history([unverified, verified], {
        lastSuccessfulPortalCheckAt: savedAt,
        interruptedAt: checkedAt,
        reason,
      }),
    );

    const container = await renderMonitor({ retryOnly: true });
    const attempt = container.querySelector(
      '[aria-label="Latest City of Tampa monitoring attempt"]',
    );
    const summary = container.querySelector(
      '[aria-label="Last verified City of Tampa portal result"]',
    );

    expect(attempt?.textContent).toContain('Unverified');
    expect(container.textContent).toContain(reason);
    expect(attempt?.textContent).toContain('Public page read');
    expect(attempt?.textContent).toContain(
      'The public City page was reached, but it did not provide a readable Record Status. This attempt did not verify a current status.',
    );
    expect(attempt?.querySelector('time')?.getAttribute('dateTime')).toBe(checkedAt);
    expect(attempt?.querySelector('a')?.getAttribute('href')).toBe(tampaUrl);
    expect(summary?.textContent).toContain('Complete');
    expect(summary?.textContent).toContain('last successful public reading');
    expect(summary?.textContent).toContain('Last successful public City of Tampa result · Record Status');
    expect(summary?.querySelector('time')?.getAttribute('dateTime')).toBe(savedAt);
    expect(container.textContent).toContain('Retry check');
  });

  it('labels the checked value as a verified public City result with its source and read time', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const readAt = '2026-10-31T09:59:00.000Z';
    apiFetchMock.mockResolvedValue(
      history(
        [createCheck('checked', savedAt, 'Technical Review', null, readAt)],
        { lastSuccessfulPortalCheckAt: savedAt, interruptedAt: null, reason: null },
      ),
    );

    const container = await renderMonitor();
    const summary = container.querySelector(
      '[aria-label="Last verified City of Tampa portal result"]',
    );

    expect(summary?.textContent).toContain('Verified public City of Tampa result · Record Status');
    expect(summary?.textContent).toContain('Technical Review');
    expect(summary?.textContent).toContain('City page read');
    expect(summary?.querySelectorAll('time')[0]?.getAttribute('dateTime')).toBe(savedAt);
    expect(summary?.querySelectorAll('time')[1]?.getAttribute('dateTime')).toBe(readAt);
    expect(summary?.querySelector('a')?.getAttribute('href')).toBe(tampaUrl);
    expect(container.textContent).toContain('Run public check');
    expect(container.textContent).toContain(
      'Checks read only the public City of Tampa page; they do not access secure or applicant-only records.',
    );
  });

  it('keeps a different unverified reason accurate when an older public result exists', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const checkedAt = '2026-10-31T10:05:00.000Z';
    const reason = 'The public page did not confirm this permit number.';
    apiFetchMock.mockResolvedValue(
      history(
        [
          createCheck('unverified', checkedAt, null, reason, '2026-10-31T10:04:00.000Z'),
          createCheck('checked', savedAt, 'Complete', null),
        ],
        { lastSuccessfulPortalCheckAt: savedAt, interruptedAt: checkedAt, reason },
      ),
    );

    const container = await renderMonitor({ retryOnly: true });
    const summary = container.querySelector(
      '[aria-label="Last verified City of Tampa portal result"]',
    );
    const attempt = container.querySelector(
      '[aria-label="Latest City of Tampa monitoring attempt"]',
    );

    expect(attempt?.textContent).toContain(reason);
    expect(attempt?.textContent).not.toContain('did not provide a readable Record Status');
    expect(summary?.textContent).toContain('Complete');
    expect(summary?.textContent).toContain('last successful public reading');
    expect(container.textContent).toContain('Retry check');
  });

  it.each(['unverified', 'unavailable'] as const)(
    'keeps Run public check available in the permit list after a latest %s result',
    async (result) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const reason = 'The public City record could not be verified.';
      apiFetchMock.mockResolvedValue(
        history(
          [createCheck(result, savedAt, null, reason)],
          { lastSuccessfulPortalCheckAt: null, interruptedAt: savedAt, reason },
        ),
      );

      const container = await renderMonitor();

      expect(container.querySelector('button')?.textContent).toBe('Run public check');
      expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(false);
    },
  );

  it.each([true, false])(
    'explains an interrupted check without implying a missing field (prior result: %s)',
    async (hasPriorResult) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const failedAt = '2026-10-31T10:05:00.000Z';
      const reason = 'The public City record page could not be read.';
      const checks = [createCheck('unavailable', failedAt, null, reason)];
      if (hasPriorResult) checks.push(createCheck('checked', savedAt, 'Issued', null));
      apiFetchMock.mockResolvedValue(
        history(checks, {
          lastSuccessfulPortalCheckAt: hasPriorResult ? savedAt : null,
          interruptedAt: failedAt,
          reason,
        }),
      );

      const container = await renderMonitor({ retryOnly: true });
      const summary = container.querySelector(
        '[aria-label="Last verified City of Tampa portal result"]',
      );
      const attempt = container.querySelector(
        '[aria-label="Latest City of Tampa monitoring attempt"]',
      );

      expect(attempt?.textContent).toContain(
        'This public check did not complete, so it could not determine a current public status.',
      );
      expect(attempt?.textContent).toContain(`Check detail: ${reason}`);
      expect(attempt?.textContent).not.toContain('did not provide a readable Record Status');
      expect(container.textContent).toContain('Retry check');
      if (hasPriorResult) {
        expect(summary?.textContent).toContain('Issued');
        expect(summary?.textContent).toContain('last successful public reading');
        expect(summary?.querySelector('a')?.getAttribute('href')).toBe(tampaUrl);
      } else {
        expect(summary?.textContent).toContain(
          'No successful City of Tampa result has been verified yet.',
        );
        expect(summary?.textContent).not.toContain('Issued');
      }
    },
  );

  it.each([
    { label: 'permit number', permitNumber: '', portalUrl: tampaUrl },
    { label: 'direct City URL', permitNumber: '2026-010101', portalUrl: '' },
  ])('shows edit guidance and disables the check action without a $label', async (input) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    apiFetchMock.mockResolvedValue(
      history([], { lastSuccessfulPortalCheckAt: null, interruptedAt: null, reason: null }),
    );

    const container = await renderMonitor(input);

    expect(container.textContent).toContain(
      'Add the permit number and its direct City of Tampa Building Accela record URL under Edit to enable an on-demand public check.',
    );
    expect(container.querySelector('button')?.textContent).toBe('Run public check');
    expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    expect(container.textContent).not.toContain('Retry check');
  });

  it('keeps Retry check disabled for archived permits', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const reason = 'The public City record could not be verified.';
    apiFetchMock.mockResolvedValue(
      history(
        [createCheck('unavailable', savedAt, null, reason)],
        { lastSuccessfulPortalCheckAt: null, interruptedAt: savedAt, reason },
      ),
    );

    const container = await renderMonitor({ retryOnly: true, archived: true });

    expect(container.textContent).toContain('Archived permits are read-only.');
    expect(container.querySelector('button')?.textContent).toBe('Retry check');
    expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });
});
