import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  eligibility: { eligible: false, needsVerification: true },
}));
const sessionUser = vi.hoisted(() => ({ id: 'owner-user', role: 'user' }));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: sessionUser } }),
  useIsAdmin: () => false,
}));
vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(async () => state.eligibility),
}));

import { OwnerAccessCode } from '@/components/custom/owner-access-code';

describe('owner access code', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.eligibility = { eligible: false, needsVerification: true };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<OwnerAccessCode />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('shows a verification note instead of the code form', async () => {
    await render();
    expect(container.textContent).toContain('Verify your email before using the owner access code');
    expect(container.querySelector('input')).toBeNull();
  });

  it('shows the code form once the mailbox is verified', async () => {
    state.eligibility = { eligible: true, needsVerification: false };
    await render();
    expect(container.querySelector('#owner-access-code')).not.toBeNull();
    expect(container.textContent).not.toContain(
      'Verify your email before using the owner access code',
    );
  });
});
