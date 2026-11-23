import { describe, expect, it } from 'vitest';
import { permitCorrectionChecklistCreatedEmail } from '@/lib/email/templates';

describe('permitCorrectionChecklistCreatedEmail', () => {
  it('identifies a permit by its recorded number and links to its private checklist', () => {
    const checklistUrl =
      'https://docketkite.example.test/dashboard/permits/permit-1/letters/letter-1/checklist';
    const email = permitCorrectionChecklistCreatedEmail({
      permitReference: 'DK-1042',
      projectName: 'North shop addition',
      permitNumber: 'DK-1042',
      checklistUrl,
    });

    expect(email.subject).toBe('Correction checklist created: DK-1042');
    expect(email.text).toContain('permit DK-1042');
    expect(email.text).toContain(checklistUrl);
    expect(email.html).toContain(`href="${checklistUrl}"`);
  });

  it('falls back to the project name when the permit number is blank', () => {
    const email = permitCorrectionChecklistCreatedEmail({
      permitReference: 'North shop addition',
      projectName: 'North shop addition',
      permitNumber: '',
      checklistUrl:
        'https://docketkite.example.test/dashboard/permits/permit-1/letters/letter-1/checklist',
    });

    expect(email.subject).toBe('Correction checklist created: North shop addition');
    expect(email.text).toContain('for North shop addition');
  });
});
