// @polsia:framework-owned — DO NOT EDIT. Stable content contract for the
// comparison page. Customer-specific products, claims and CTA values live in
// the user-owned src/lib/comparison/content.ts file and must satisfy these types.

export type ComparisonValue = boolean | string;

export interface ComparisonColumn {
  id: string;
  name: string;
  description?: string;
  badge?: string;
  featured?: boolean;
}

export interface ComparisonRow {
  label: string;
  description?: string;
  values: Record<string, ComparisonValue>;
}

export interface ComparisonGroup {
  label: string;
  rows: ComparisonRow[];
}

export interface ComparisonCta {
  title: string;
  description: string;
  label: string;
  href: string;
}

export interface ComparisonContent {
  eyebrow?: string;
  title: string;
  intro: string;
  tableCaption: string;
  columns: ComparisonColumn[];
  groups: ComparisonGroup[];
  lastReviewed: string;
  disclaimer: string;
  cta: ComparisonCta;
}
