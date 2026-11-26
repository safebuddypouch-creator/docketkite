// @polsia:user-owned — persisted checklist fields included in the PDF document spec.
import { describe, expect, it } from 'vitest';
import { buildPermitChecklistPdfSpec } from '@/lib/business/permit-checklist-pdf';
import { blockDocumentSpecSchema } from '@/lib/pdf/schema';

describe('buildPermitChecklistPdfSpec', () => {
  it('preserves permit, source, generation time, checklist order and saved completion state', () => {
    const spec = buildPermitChecklistPdfSpec({
      permitReference: 'BLD-2026-0042',
      sourceFileName: 'correction-letter.pdf',
      generatedAt: new Date('2026-10-31T12:34:56.000Z'),
      items: [
        {
          action: 'Revise the north elevation notes.',
          location: 'North elevation',
          planReference: 'A2.1',
          completed: true,
        },
        {
          action: 'Clarify the window schedule.',
          location: 'West elevation',
          planReference: null,
          completed: false,
        },
      ],
    });
    const parsed = blockDocumentSpecSchema.parse(spec);
    const permitDetails = parsed.blocks.find((block) => block.type === 'keyValue');
    const corrections = parsed.blocks.find((block) => block.type === 'list');

    expect(permitDetails).toMatchObject({
      type: 'keyValue',
      rows: [
        { label: 'Permit reference', value: 'BLD-2026-0042' },
        { label: 'Source letter', value: 'correction-letter.pdf' },
        { label: 'Generated at (UTC)', value: '2026-10-31T12:34:56.000Z' },
      ],
    });
    expect(corrections).toMatchObject({
      type: 'list',
      ordered: true,
      items: [
        'Action: Revise the north elevation notes.\nLocation: North elevation\nPlan reference: A2.1\nStatus: Completed',
        'Action: Clarify the window schedule.\nLocation: West elevation\nPlan reference: Not saved\nStatus: Open',
      ],
    });
  });

  it('keeps a readable empty state if a saved checklist has no items', () => {
    const spec = buildPermitChecklistPdfSpec({
      permitReference: 'BLD-2026-0043',
      sourceFileName: 'source-letter.pdf',
      generatedAt: new Date('2026-10-31T12:34:56.000Z'),
      items: [],
    });

    expect(blockDocumentSpecSchema.parse(spec).blocks).toContainEqual({
      type: 'text',
      text: 'No saved correction items.',
    });
  });
});
