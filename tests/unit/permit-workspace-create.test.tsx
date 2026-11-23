// @polsia:user-owned — empty, filtered, archived, and create-result permit workspace behavior.
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/components/custom/csv-exporter', () => ({ CsvExporter: () => null }));
vi.mock('@/components/custom/csv-importer', () => ({ CsvImporter: () => null }));
vi.mock('@/components/custom/permit-letter-draft', () => ({ PermitLetterDraft: () => null }));
vi.mock('@/components/custom/permit-portal-monitor', () => ({ PermitPortalMonitor: () => null }));

import { PermitWorkspace } from '@/components/custom/permit-workspace';

const tampaRecordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

let savedPermit: Record<string, unknown> | null;

function permitItem(values: Record<string, unknown> = {}) {
  return {
    id: 'permit-1',
    teamId: 'team-1',
    projectName: 'Willow Street kitchen remodel',
    address: '101 Sample Street, Tampa, FL',
    permitNumber: 'BLD-27-0529173',
    permitType: 'Building',
    status: 'Planning',
    notes: '',
    portalUrl: tampaRecordUrl,
    portalCurrentStatus: null,
    portalStatusObservedAt: null,
    archivedAt: null,
    createdAt: '2026-11-16T12:00:00.000Z',
    updatedAt: '2026-11-16T12:00:00.000Z',
    assignedProjectManager: null,
    statusEvents: [],
    ...values,
  };
}

function installListResponses() {
  mocks.apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.startsWith('/api/permits?')) {
      return { items: savedPermit ? [savedPermit] : [], projectManagers: [] };
    }
    if (path.startsWith('/api/permit-letters?')) return { items: [] };
    if (path.startsWith('/api/permit-status-counts?')) return { items: [] };
    if (path === '/api/permits' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      savedPermit = permitItem(body);
      return savedPermit;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function findButton(container: HTMLDivElement, label: string) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function clickFirstPermit(container: HTMLDivElement) {
  const button = findButton(container, 'Add your first permit');
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await flush();
  });
}

async function fillCreateForm(container: HTMLDivElement) {
  const values = new Map([
    ['permit-number', 'BLD-27-0529173'],
    ['permit-project-name', 'Willow Street kitchen remodel'],
    ['permit-address', '101 Sample Street, Tampa, FL'],
  ]);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  for (const [id, value] of values) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`);
    expect(input).not.toBeNull();
    await act(async () => {
      setter?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const portalInput = container.querySelector<HTMLInputElement>('input[type="url"]');
  expect(portalInput).not.toBeNull();
  await act(async () => {
    setter?.call(portalInput, tampaRecordUrl);
    portalInput?.dispatchEvent(new Event('input', { bubbles: true }));
    portalInput?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submitCreateForm(container: HTMLDivElement) {
  const form = container.querySelector('#new-permit-title')?.parentElement?.parentElement?.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
}

describe('permit workspace first-create flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.apiFetch.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    savedPermit = null;
    installListResponses();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the first-permit action only for the ordinary active empty state and opens required fields', async () => {
    await act(async () => {
      root.render(<PermitWorkspace teamId="team-1" role="owner" initialStatus={null} />);
      await flush();
    });

    expect(container.textContent).toContain('No active permits yet.');
    expect(container.textContent).toContain('does not file with the City');
    await clickFirstPermit(container);

    const permitNumber = container.querySelector<HTMLInputElement>('#permit-number');
    const portalUrl = container.querySelector<HTMLInputElement>('input[type="url"]');
    const projectName = container.querySelector<HTMLInputElement>('#permit-project-name');
    const address = container.querySelector<HTMLInputElement>('#permit-address');
    expect(permitNumber?.required).toBe(true);
    expect(portalUrl?.required).toBe(true);
    expect(projectName?.required).toBe(true);
    expect(address?.required).toBe(true);
    await submitCreateForm(container);
    expect(container.textContent).toContain('Enter the permit reference shown on the City record');
    expect(container.textContent).toContain('Enter a project name');
    expect(container.textContent).toContain('Enter the job address');
    expect(container.textContent).toContain(
      'A direct public City record URL is required for a public-record check.',
    );
    expect(mocks.apiFetch.mock.calls.some(([path]) => path === '/api/permits')).toBe(false);
  });

  it('keeps filtered and Archived empty states distinct and offers the matching recovery control', async () => {
    await act(async () => {
      root.render(<PermitWorkspace teamId="team-1" role="owner" initialStatus="Issued" />);
      await flush();
    });

    expect(container.textContent).toContain('No active permits have saved status “Issued”.');
    expect(findButton(container, 'Add your first permit')).toBeUndefined();
    expect(container.querySelector('a[href="/dashboard?teamId=team-1"]')?.textContent).toBe(
      'Clear status filter',
    );

    await act(async () => {
      findButton(container, 'Archived')?.click();
      await flush();
    });

    expect(container.textContent).toContain('No archived permits have saved status “Issued”.');
    expect(findButton(container, 'Add your first permit')).toBeUndefined();
    expect(container.querySelector('a[href="/dashboard?teamId=team-1"]')?.textContent).toBe(
      'Clear status filter',
    );
  });

  it('closes after the API confirms creation, reports success, and reloads the selected team list', async () => {
    await act(async () => {
      root.render(<PermitWorkspace teamId="team-1" role="owner" initialStatus={null} />);
      await flush();
    });
    await clickFirstPermit(container);
    await fillCreateForm(container);
    await submitCreateForm(container);

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/permits',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('team-1') }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Permit added to your list.');
    expect(container.textContent).toContain('Willow Street kitchen remodel');
    expect(container.querySelector('#new-permit-title')).toBeNull();
    expect(mocks.apiFetch.mock.calls.filter(([path]) => String(path).startsWith('/api/permits?')))
      .toHaveLength(2);
  });

  it('maps API validation errors onto fields without clearing the entered reference', async () => {
    await act(async () => {
      root.render(<PermitWorkspace teamId="team-1" role="owner" initialStatus={null} />);
      await flush();
    });
    await clickFirstPermit(container);
    await fillCreateForm(container);
    mocks.apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/permits' && options?.method === 'POST') {
        throw new Error('validation failed', {
          cause: { errors: { permitNumber: 'The permit reference was rejected.' } },
        });
      }
      if (path.startsWith('/api/permits?')) return { items: [], projectManagers: [] };
      if (path.startsWith('/api/permit-letters?')) return { items: [] };
      if (path.startsWith('/api/permit-status-counts?')) return { items: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    await submitCreateForm(container);

    expect(container.textContent).toContain('The permit reference was rejected.');
    expect(container.querySelector<HTMLInputElement>('#permit-number')?.value).toBe(
      'BLD-27-0529173',
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [403, { error: 'team_membership_required' }, 'You no longer have access to this team.'],
    [402, { error: 'team_subscription_required' }, 'This team does not have active permit access.'],
    [500, { error: 'Could not create this permit' }, 'Could not save this permit. Please try again.'],
  ])('keeps the form open and reports an action error after HTTP %s', async (_status, body, message) => {
    await act(async () => {
      root.render(<PermitWorkspace teamId="team-1" role="project_manager" initialStatus={null} />);
      await flush();
    });
    await clickFirstPermit(container);
    await fillCreateForm(container);
    mocks.apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/permits' && options?.method === 'POST') {
        throw new Error('create failed', { cause: body });
      }
      if (path.startsWith('/api/permits?')) return { items: [], projectManagers: [] };
      if (path.startsWith('/api/permit-letters?')) return { items: [] };
      if (path.startsWith('/api/permit-status-counts?')) return { items: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    await submitCreateForm(container);

    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(container.querySelector('#new-permit-title')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#permit-number')?.value).toBe(
      'BLD-27-0529173',
    );
  });
});
