// @polsia:user-owned — builds a printable PDF spec from persisted checklist records.
import type { BlockDocumentSpec } from '@/lib/pdf/schema';

export interface PermitChecklistPdfItem {
  action: string;
  location: string | null;
  planReference: string | null;
  completed: boolean;
}

export interface PermitChecklistPdfData {
  permitReference: string;
  sourceFileName: string;
  generatedAt: Date;
  items: readonly PermitChecklistPdfItem[];
}

function savedValue(value: string | null): string {
  return value?.trim() || 'Not saved';
}

export function buildPermitChecklistPdfSpec(data: PermitChecklistPdfData): BlockDocumentSpec {
  const generatedAt = data.generatedAt.toISOString();

  return {
    metadata: {
      title: `Correction checklist — ${data.permitReference}`,
      subject: 'Saved permit correction checklist',
    },
    page: { margins: { top: 48, right: 48, bottom: 48, left: 48 } },
    defaultTextStyle: { fontSize: 10.5, lineHeight: 1.4, color: '#25282C' },
    styles: {
      h1: { fontSize: 25, color: '#20252B', spaceAfter: 10 },
      h2: { fontSize: 15, color: '#9E252B', spaceAfter: 8 },
      list: { spaceAfter: 10 },
      keyValue: { labelColor: '#5E6268', spaceAfter: 12 },
    },
    blocks: [
      { type: 'heading', level: 1, text: 'Correction checklist' },
      {
        type: 'keyValue',
        rows: [
          { label: 'Permit reference', value: data.permitReference },
          { label: 'Source letter', value: data.sourceFileName },
          { label: 'Generated at (UTC)', value: generatedAt },
        ],
      },
      { type: 'rule', color: '#C8C9CB', spaceAfter: 12 },
      { type: 'heading', level: 2, text: 'Saved corrections' },
      ...(data.items.length > 0
        ? [
            {
              type: 'list' as const,
              ordered: true,
              items: data.items.map(
                (item) =>
                  `Action: ${item.action}\nLocation: ${savedValue(item.location)}\nPlan reference: ${savedValue(item.planReference)}\nStatus: ${item.completed ? 'Completed' : 'Open'}`,
              ),
            },
          ]
        : [{ type: 'text' as const, text: 'No saved correction items.' }]),
    ],
  };
}
