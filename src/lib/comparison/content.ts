// @polsia:user-owned — sourced City of Tampa permit coverage comparison.
import type { ComparisonContent } from '@/modules/comparison-page/types';

export const comparisonContent: ComparisonContent = {
  eyebrow: 'City of Tampa permit coverage · reviewed November 17, 2026',
  title: 'The City record, and what DocketKite can read from it.',
  intro:
    'DocketKite supports City of Tampa municipal permit records through the City’s official Accela portal. A Tampa mailing address alone does not establish jurisdiction. This page distinguishes what the public portal exposed in a small anonymous sample from what the team workspace does today.',
  tableCaption: 'City of Tampa Accela public permit records and DocketKite workflow',
  columns: [
    {
      id: 'tampa-accela',
      name: 'City of Tampa Accela',
      description: 'Official municipal permit record portal',
    },
    {
      id: 'docketkite',
      name: 'DocketKite',
      description: 'Team workspace with on-demand public checks',
      badge: 'Current workflow',
      featured: true,
    },
  ],
  groups: [
    {
      label: 'Coverage and public access',
      rows: [
        {
          label: 'Jurisdiction',
          description: 'Permit records must belong to the City of Tampa.',
          values: {
            'tampa-accela': 'City of Tampa municipal records in the TAMPA Accela agency.',
            docketkite:
              'Only direct City of Tampa Accela Building record URLs are accepted for active checks. Hillsborough County, nearby municipalities, and broader Tampa-area coverage are unsupported.',
          },
        },
        {
          label: 'Search without applicant credentials',
          values: {
            'tampa-accela':
              'The City guide says general records are searchable without an account. Records exempt under Florida public-records law are marked secure; secure files require an authorized contact.',
            docketkite:
              'Checks use the public record page only and do not sign in as an applicant or contact.',
          },
        },
        {
          label: 'Record identity and public status',
          values: {
            'tampa-accela':
              'In the documented anonymous sample, record IDs and the displayed raw Record Status were visible, including In Process and Awaiting Client Reply. These are sample observations, not a complete list of visible fields or statuses.',
            docketkite:
              'Stores the exact Record Status only when a successful page read confirms the saved permit number. Other statuses are not inferred or normalized.',
          },
        },
      ],
    },
    {
      label: 'Checks, alerts, and correction letters',
      rows: [
        {
          label: 'Check cadence',
          values: {
            'tampa-accela': 'The portal is available for a person to search and open records.',
            docketkite:
              'A team member starts each check. Checks are on demand, not continuous or scheduled; page retrieval can be cached.',
          },
        },
        {
          label: 'Status change detection and notice',
          values: {
            'tampa-accela':
              'The reviewed public guide documents record search, not DocketKite alerts.',
            docketkite:
              'A change is detected only between successful observations for the same permit. The assigned project manager can receive email for a verified transition; the team owner can receive email when a check is interrupted. Failed checks do not create change alerts.',
          },
        },
        {
          label: 'Correction-letter contents',
          values: {
            'tampa-accela':
              'The sampled public pages exposed conditions and attachment-list metadata, but no correction-letter file was confirmed accountless. A visible Stop Work Order remained a condition, not a remapped status. Secure files require an authorized contact.',
            docketkite:
              'A team member can upload a letter the team is authorized to access. Extraction is a draft; reviewed correction information drives the checklist. Automatic public attachment retrieval is not claimed.',
          },
        },
        {
          label: 'Same-day SMS and checklist offer',
          values: {
            'tampa-accela': 'Not a DocketKite notification channel.',
            docketkite:
              'The planned offer is a same-day project-manager text for a correction letter, hold, or approval plus a short checklist. SMS is planned and unavailable today.',
          },
        },
      ],
    },
  ],
  lastReviewed: 'November 17, 2026',
  disclaimer:
    'A small anonymous sample showed record IDs, displayed raw Record Status values, conditions, and attachment-list metadata. It does not establish a complete list of public fields or statuses, or public access to every file. The City identifies designated secure files as contact-only. DocketKite checks are on demand and email notifications depend on a verified status transition or an interrupted check; SMS is unavailable.',
  cta: {
    title: 'Open the official City of Tampa portal',
    description:
      'Search City records directly. Confirm the municipality from the official record, not from a Tampa mailing address alone.',
    label: 'Open Accela Building records',
    href: 'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
  },
};

export const comparisonAccessLimits = {
  eyebrow: 'Tampa public-access guide',
  heading: 'What a public search can confirm—and where access stops',
  publicHeading: 'Public search and sampled status details',
  publicCopy:
    'The City of Tampa’s Accela guide says general public permit records can be searched without an account or login. In the documented anonymous sample, record IDs and the displayed raw Record Status were visible, including “In Process” and “Awaiting Client Reply.” Those are sample observations, not a complete list of visible fields or statuses.',
  sampleCopy:
    'The sample also showed conditions and attachment-list metadata, but did not confirm publicly accessible correction-letter files. “Stop Work Order” was observed as a condition, not a remapped permit status.',
  secureHeading: 'Some records and files need authorized access',
  secureCopy:
    'The City guide says records exempt under F.S. 119.071 are unavailable to the public and that secure files are marked “secure.” The observed file label was “SECURED PLANS.” Opening a designated secure file requires being an authorized contact for that permit and logged into Accela. This does not mean every attachment is secure.',
  workflowHeading: 'A team-uploaded letter is a separate workflow',
  workflowCopy:
    'Your team can upload a letter it can already access for review and a checklist. That is separate from public-portal checks: DocketKite does not sign in to Accela, retrieve credential-protected records, or monitor files that require authorized access.',
  requestHeading: 'Requesting other public records',
  requestCopy:
    'Under City policy, any person may request non-exempt public records through the City’s GovQA portal, subject to statutory exemptions. This is a separate request to the City; it is not DocketKite access or monitoring.',
  unverifiedHeading: 'Limits the available sources do not settle',
  unverifiedIntro:
    'These details remain unverified, so this guide does not make claims about them:',
  unverifiedItems: [
    'Which fields an Accela API exposes or hides.',
    'The exact interface shown for a restricted record, or how the portal distinguishes a missing record from a restricted one.',
    'The complete list of statutory exemptions that may apply.',
  ],
};

export interface ComparisonSource {
  id: string;
  label: string;
  publisher: string;
  href: string;
}

export const comparisonSources: ComparisonSource[] = [
  {
    id: 'tampa-accela',
    label: 'City of Tampa Accela Building permit portal',
    publisher: 'City of Tampa',
    href: 'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
  },
  {
    id: 'tampa-public-records-guide',
    label: 'Accela Guide: Search for Permits by Record Number',
    publisher: 'City of Tampa',
    href: 'https://www.tampa.gov/sites/default/files/document/2026/accela_guide_search_for_permits_by_record_number_ada.pdf',
  },
  {
    id: 'tampa-public-records-policy',
    label: 'Public Records Requests—City of Tampa Policy and Guide (March 2025)',
    publisher: 'City of Tampa',
    href: 'https://www.tampa.gov/sites/default/files/document/2025/public-records-policy-and-guide-revised-3242025.pdf',
  },
  {
    id: 'docketkite-home',
    label: 'DocketKite coverage and current workflow',
    publisher: 'DocketKite',
    href: '/',
  },
  {
    id: 'docketkite-workspace',
    label: 'DocketKite team workspace',
    publisher: 'DocketKite',
    href: '/login',
  },
];

export const comparisonCitations: Record<string, Record<string, readonly string[]>> = {
  Jurisdiction: {
    'tampa-accela': ['tampa-accela'],
    docketkite: ['docketkite-home', 'docketkite-workspace'],
  },
  'Search without applicant credentials': {
    'tampa-accela': ['tampa-public-records-guide'],
    docketkite: ['docketkite-workspace'],
  },
  'Record identity and public status': {
    'tampa-accela': ['tampa-accela'],
    docketkite: ['docketkite-workspace'],
  },
  'Check cadence': {
    'tampa-accela': ['tampa-accela'],
    docketkite: ['docketkite-workspace'],
  },
  'Status change detection and notice': {
    docketkite: ['docketkite-workspace'],
  },
  'Correction-letter contents': {
    'tampa-accela': ['tampa-accela', 'tampa-public-records-guide'],
    docketkite: ['docketkite-workspace'],
  },
  'Same-day SMS and checklist offer': {
    docketkite: ['docketkite-home'],
  },
};

export const comparisonResearchNote =
  'The City of Tampa Accela guide says general public permit records can be searched without login; its secure-file instructions describe the authorized-contact boundary. A documented anonymous sample showed record IDs, raw displayed Record Status values, conditions, and attachment-list metadata, but did not confirm a publicly accessible correction-letter file. The sample is bounded and not a reliability claim. API field visibility, the restricted-versus-missing interface behavior, and the complete exemption list remain unverified.';
