// @polsia:user-owned — correction-letter review and checklist paid-access gates.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  permitLetterFindFirst: vi.fn(),
  checklistFindUnique: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    permitLetter: { findFirst: mocks.permitLetterFindFirst },
    permitCorrectionChecklist: { findUnique: mocks.checklistFindUnique },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: vi.fn(() => true) }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ permitCorrectionChecklistCreatedEmail: vi.fn() }));
vi.mock('@/lib/site', () => ({ siteUrl: vi.fn(() => 'https://docketkite.example.test') }));

import { GET as getChecklist } from '@/app/api/permit-letters/[letterId]/checklist/route';
import { GET as getReview } from '@/app/api/permit-letters/[letterId]/review/route';

const billingFailures = [
  ['unpaid', 402],
  ['pending', 402],
  ['inactive', 402],
  ['unavailable', 503],
] as const;

function request(resource: 'checklist' | 'review') {
  return new Request(
    `http://localhost/api/permit-letters/letter-1/${resource}?permitId=permit-1`,
  );
}

const context = { params: Promise.resolve({ letterId: 'letter-1' }) };

describe('correction-letter and checklist paid access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.permitLetterFindFirst.mockResolvedValue({
      id: 'letter-1',
      teamId: 'team-1',
      permitId: 'permit-1',
      fileName: 'correction-letter.pdf',
    });
  });

  it.each(billingFailures)(
    'does not return saved correction review or checklist data while billing is %s',
    async (paymentStatus, statusCode) => {
      mocks.requireTeamAccess.mockResolvedValue({
        response: Response.json({ error: 'team_subscription_required', paymentStatus }, {
          status: statusCode,
        }),
      });

      const review = await getReview(request('review'), context);
      expect(review.status).toBe(statusCode);
      expect(mocks.permitLetterFindFirst).toHaveBeenCalledTimes(1);

      mocks.permitLetterFindFirst.mockClear();
      const checklist = await getChecklist(request('checklist'), context);
      expect(checklist.status).toBe(statusCode);
      expect(mocks.permitLetterFindFirst).toHaveBeenCalledTimes(1);
      expect(mocks.checklistFindUnique).not.toHaveBeenCalled();
    },
  );
});
