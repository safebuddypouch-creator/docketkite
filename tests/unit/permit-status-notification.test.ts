import { describe, expect, it } from 'vitest';
import { didPermitStatusChange } from '@/lib/business/permit-status';
import { portalStatusesEquivalent } from '@/lib/business/permit-status-detections';
import { PermitMutation, PermitStatusEvent } from '@/lib/contracts/permit';
import {
  permitMonitoringInterruptedEmail,
  permitPortalStatusDetectedEmail,
  permitStatusChangedEmail,
} from '@/lib/email/templates';

describe('permit status notifications', () => {
  it('detects a saved status transition but ignores unchanged status', () => {
    expect(didPermitStatusChange('Planning', 'Submitted')).toBe(true);
    expect(didPermitStatusChange('Submitted', 'Submitted')).toBe(false);
  });

  it('includes the private team, permit, previous status, and saved status in the email', () => {
    const message = permitStatusChangedEmail({
      teamName: 'QA Permit Team',
      projectName: 'Sample remodel',
      address: '101 Test Street, Tampa',
      previousStatus: 'Planning',
      status: 'Submitted',
      permitUrl: 'https://docketkite.example.test/dashboard/permits/permit_1',
    });

    expect(message.subject).toBe('Permit status changed: Sample remodel');
    expect(message.text).toContain('QA Permit Team: Sample remodel');
    expect(message.text).toContain('Status changed from Planning to Submitted.');
    expect(message.text).toContain('Job address: 101 Test Street, Tampa');
    expect(message.text).toContain(
      'View permit in DocketKite: https://docketkite.example.test/dashboard/permits/permit_1',
    );
    expect(message.html).toContain(
      'href="https://docketkite.example.test/dashboard/permits/permit_1"',
    );
  });

  it('compares public status labels without case or whitespace-only differences', () => {
    expect(portalStatusesEquivalent('Corrections requested', ' CORRECTIONS   REQUESTED ')).toBe(
      true,
    );
    expect(portalStatusesEquivalent('Corrections requested', 'Issued')).toBe(false);
  });

  it('includes the exact public status transition, letter checklist, and direct City record link', () => {
    const checkedAt = new Date('2026-10-31T09:14:05.000Z');
    const sourceUrl =
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';
    const message = permitPortalStatusDetectedEmail({
      projectName: 'Sample remodel',
      permitNumber: 'BLD-27-0529173',
      previousStatus: 'In Process',
      status: 'Awaiting Client Reply',
      checkedAt,
      sourceUrl,
      correctionChecklist: [
        'Add the missing fixture schedule (Plan E-2)',
        'Provide the requested equipment specifications',
      ],
    });

    expect(message.subject).toBe('Public permit status changed: Sample remodel');
    expect(message.text).toContain('Detected public status: Awaiting Client Reply');
    expect(message.text).toContain('Record Status changed from In Process to Awaiting Client Reply.');
    expect(message.text).toContain('Checked at (UTC): 2026-10-31T09:14:05.000Z');
    expect(message.text).toContain('1. Add the missing fixture schedule (Plan E-2)');
    expect(message.text).toContain('2. Provide the requested equipment specifications');
    expect(message.text).toContain(`Official Florida Accela record: ${sourceUrl}`);
    expect(message.html).toContain(`href="${sourceUrl.replace(/&/g, '&amp;')}"`);
  });

  it('does not invent a correction checklist when no confirmed letter checklist exists', () => {
    const message = permitPortalStatusDetectedEmail({
      projectName: 'Sample remodel',
      permitNumber: 'BLD-27-0529173',
      previousStatus: 'In Process',
      status: 'Awaiting Client Reply',
      checkedAt: new Date('2026-10-31T09:14:05.000Z'),
      sourceUrl: 'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?capID3=02UTH',
      correctionChecklist: [],
    });

    expect(message.text).toContain('No confirmed correction-letter checklist is saved for this permit.');
    expect(message.text).not.toContain('1. ');
  });

  it('includes the saved interruption reference, result, reason, timestamp, and private permit link', () => {
    const checkedAt = new Date('2026-10-31T10:20:30.000Z');
    const permitUrl = 'https://docketkite.example.test/dashboard/permits/permit_2';
    const email = permitMonitoringInterruptedEmail({
      projectName: 'Willow Street remodel',
      permitNumber: '2026-020202',
      result: 'unavailable',
      reason: 'The public City record page could not be read.',
      checkedAt,
      permitUrl,
    });

    expect(email.subject).toBe('Permit monitoring interrupted: 2026-020202');
    expect(email.text).toContain('Permit 2026-020202');
    expect(email.text).toContain('Saved outcome: unavailable');
    expect(email.text).toContain('Reason: The public City record page could not be read.');
    expect(email.text).toContain('Checked at (UTC): 2026-10-31T10:20:30.000Z');
    expect(email.text).toContain(`Open private permit: ${permitUrl}`);
    expect(email.html).toContain(`href="${permitUrl}"`);
  });

  it('uses the project name as the permit reference when no number is saved', () => {
    const email = permitMonitoringInterruptedEmail({
      projectName: 'Willow Street remodel',
      permitNumber: '',
      result: 'unverified',
      reason: 'The public page did not confirm this permit number.',
      checkedAt: new Date('2026-10-31T10:20:30.000Z'),
      permitUrl: 'https://docketkite.example.test/dashboard/permits/permit_2',
    });

    expect(email.subject).toBe('Permit monitoring interrupted: Willow Street remodel');
    expect(email.text).toContain('Willow Street remodel');
  });

  it('accepts an optional bounded false-alarm reason on permit status updates', () => {
    const update = {
      action: 'update',
      id: 'permit_1',
      teamId: 'team_1',
      data: {
        projectName: 'Sample remodel',
        address: '101 Test Street, Tampa',
        permitNumber: '',
        permitType: 'Building',
        status: 'Submitted',
        notes: '',
      },
    };

    expect(PermitMutation.safeParse(update).success).toBe(true);
    expect(
      PermitMutation.safeParse({ ...update, falseAlarmReason: 'Portal status was stale.' })
        .success,
    ).toBe(true);
    expect(PermitMutation.safeParse({ ...update, falseAlarmReason: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('validates persisted status event timestamps and optional false-alarm reasons', () => {
    expect(
      PermitStatusEvent.safeParse({
        id: 'event_1',
        status: 'Submitted',
        falseAlarmReason: null,
        createdAt: '2026-10-29T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
