// @polsia:user-owned — empty-account team creation and visible checkout controls.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), useIsAdmin: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/auth-client', () => ({ useIsAdmin: mocks.useIsAdmin }));
vi.mock('@/components/custom/permit-workspace', () => ({ PermitWorkspace: () => null }));
vi.mock('@/components/custom/team-status-alert-recipient-settings', () => ({
  TeamStatusAlertRecipientSettings: () => null,
}));

import { TeamWorkspace } from '@/components/custom/team-workspace';

const newTeam = {
  id: 'team-1',
  name: 'Tampa Remodelers',
  joinCode: 'TEAMCODE123',
  role: 'owner',
  paymentStatus: 'unpaid' as const,
  accessActive: false,
  accessMode: 'free_trial' as const,
  trialStartedAt: '2026-11-16T10:00:00.000Z',
  trialEndsAt: '2026-12-16T10:00:00.000Z',
  trialStatus: 'active' as const,
};

describe('first team workspace onboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T12:00:00.000Z'));
    mocks.apiFetch.mockReset();
    mocks.useIsAdmin.mockReturnValue(false);
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

  it('starts with visible create controls, creates an owner team, and connects the checkout control', async () => {
    let teamExists = false;
    mocks.apiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/api/teams' && options?.method === 'POST') {
        teamExists = true;
        return newTeam;
      }
      if (path === '/api/teams') return { items: teamExists ? [newTeam] : [] };
      if (path === '/api/stripe-billing/checkout') {
        throw new Error('checkout stand-in failure');
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => {
      root.render(<TeamWorkspace initialTeamId="" initialPermitStatus={null} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector<HTMLInputElement>('#new-team-name');
    expect(nameInput).not.toBeNull();
    expect(container.textContent).toContain('Create a team');
    expect(container.textContent).toContain('Create team');
    expect(container.textContent).toContain('No team spaces yet.');

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(nameInput, 'Tampa Remodelers');
      nameInput?.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput?.dispatchEvent(new Event('change', { bubbles: true }));
      nameInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Tampa Remodelers'),
      }),
    );
    expect(container.textContent).toContain('Setup window active for Tampa Remodelers');
    expect(container.textContent).toContain('Permit records and PDF downloads stay locked');
    expect(container.textContent).toContain('29 days left in the 30-day trial for Tampa Remodelers');
    expect(container.textContent).toContain('Saved trial end: 2026-12-16 10:00:00.000 UTC');
    expect(container.textContent).toContain(
      'The $149 second-month offer for Days 11–30 is manual',
    );
    expect(
      mocks.apiFetch.mock.calls.some(([path]) => path === '/api/stripe-billing/checkout'),
    ).toBe(false);
    const checkoutButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Upgrade · $299/month'),
    );
    expect(checkoutButton).toBeDefined();
    await act(async () => {
      checkoutButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/stripe-billing/checkout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ teamId: 'team-1' }),
      }),
    );
    expect(container.textContent).toContain('checkout stand-in failure');
  });

  it('lets an unpaid account join, select, and explicitly upgrade an expired team', async () => {
    const expiredTeam = {
      ...newTeam,
      id: 'team-joined',
      name: 'Existing Tampa Team',
      role: 'purchaser',
      accessMode: 'subscription_required' as const,
      trialStartedAt: '2020-01-01T12:00:00.000Z',
      trialEndsAt: '2020-01-31T12:00:00.000Z',
      trialStatus: 'expired' as const,
    };
    let joined = false;
    mocks.apiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/api/teams' && options?.method === 'POST') {
        joined = true;
        return expiredTeam;
      }
      if (path === '/api/teams') return { items: joined ? [expiredTeam] : [] };
      if (path === '/api/stripe-billing/checkout') {
        throw new Error('checkout stand-in failure');
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => {
      root.render(<TeamWorkspace initialTeamId="" initialPermitStatus={null} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const joinInput = container.querySelector<HTMLInputElement>('#team-join-code');
    expect(joinInput).not.toBeNull();
    expect(container.textContent).toContain('Create a team');
    expect(container.textContent).toContain('Join a team');

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(joinInput, 'TEAMCODE123');
      joinInput?.dispatchEvent(new Event('input', { bubbles: true }));
      joinInput?.dispatchEvent(new Event('change', { bubbles: true }));
      joinInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'join', joinCode: 'TEAMCODE123' }),
      }),
    );
    expect(container.textContent).toContain('Trial expired');
    expect(container.textContent).toContain('No automatic charge or paid conversion occurred');
    expect(container.textContent).toContain('Your team and records remain stored');
    expect(container.textContent).toContain('Saved trial end: 2020-01-31 12:00:00.000 UTC');
    expect(
      mocks.apiFetch.mock.calls.some(([path]) => path === '/api/stripe-billing/checkout'),
    ).toBe(false);

    const upgradeButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Upgrade · $299/month'),
    );
    expect(upgradeButton).toBeDefined();
    expect(upgradeButton?.disabled).toBe(false);
    await act(async () => {
      upgradeButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/stripe-billing/checkout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ teamId: 'team-joined' }),
      }),
    );
    expect(container.textContent).toContain('checkout stand-in failure');
  });

  it('offers payment verification retry for the signed-in owner while identity is linking', async () => {
    const pendingTeam = { ...newTeam, paymentStatus: 'pending' as const };
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/teams') return { items: [pendingTeam] };
      if (path === '/api/team-checkout/verify') {
        return { verified: false, reason: 'subscription_link_pending' };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => {
      root.render(<TeamWorkspace initialTeamId="team-1" initialPermitStatus={null} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const retryButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry payment verification'),
    );
    expect(retryButton).toBeDefined();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/team-checkout/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ teamId: 'team-1' }),
      }),
    );
    expect(container.textContent).toContain('Stripe verified the payment and is still linking the subscription');
    expect(container.textContent).toContain('Permit records and PDF downloads stay locked');
  });

  it('keeps verification retry available when billing status is unavailable and names the subscription blocker', async () => {
    const unavailableTeam = { ...newTeam, paymentStatus: 'unavailable' as const };
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/teams') return { items: [unavailableTeam] };
      if (path === '/api/team-checkout/verify') {
        return {
          verified: false,
          reason: 'subscription_inactive',
          subscriptionStatus: 'incomplete',
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => {
      root.render(<TeamWorkspace initialTeamId="team-1" initialPermitStatus={null} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const retryButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry payment verification'),
    );
    expect(retryButton).toBeDefined();
    const checkoutButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Upgrade · $299/month'),
    );
    expect(checkoutButton?.disabled).toBe(false);

    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('linked subscription is incomplete');
    expect(container.textContent).toContain('No paid access was granted');
  });
});
