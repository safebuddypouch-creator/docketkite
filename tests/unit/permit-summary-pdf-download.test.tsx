// @polsia:user-owned — visible permit PDF download progress and feedback tests.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { PermitSummaryPdfDownload } from '@/components/custom/permit-summary-pdf-download';

describe('permit summary PDF download control', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalCreateObjectUrl: PropertyDescriptor | undefined;
  let originalRevokeObjectUrl: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.success.mockReset();
    mocks.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:permit-summary'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('shows progress while the server generates the PDF, then downloads and confirms success', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => root.render(<PermitSummaryPdfDownload permitId="permit-1" />));
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Download permit summary');
    expect(button?.disabled).toBe(false);

    await act(async () => button?.click());
    expect(button?.textContent).toContain('Generating PDF…');
    expect(button?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/permits/permit-1/summary-pdf', {
      cache: 'no-store',
    });

    await act(async () => {
      resolveResponse?.(
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="tampa-permit-BLD-27.pdf"',
          },
        }),
      );
    });

    expect(anchorClick).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith('Permit summary downloaded.');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(button?.disabled).toBe(false);
  });

  it('shows the missing-link reason and does not create a file after a rejected download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'official_record_link_required',
            message: 'Save a direct official City of Tampa Accela Building record URL first.',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => root.render(<PermitSummaryPdfDownload permitId="permit-1" />));
    const button = container.querySelector('button');
    await act(async () => button?.click());

    expect(mocks.error).toHaveBeenCalledWith(
      'Save a direct official City of Tampa Accela Building record URL first.',
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(button?.disabled).toBe(false);
  });
});
