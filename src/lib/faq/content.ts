// @polsia:user-owned — DocketKite FAQ content and its structured-data source.

export interface FaqItem {
  /** Stable identifier used by the display. */
  id: string;
  /** Visible question and FAQPage Question name. */
  question: string;
  /** Visible answer and FAQPage Answer text. Keep this factual and plain text. */
  answer: string;
}

export interface FaqCta {
  label: string;
  href: string;
}

export interface FaqContent {
  intro?: string;
  items: FaqItem[];
  cta: FaqCta | null;
}

export const faqContent: FaqContent = {
  intro:
    'Find where saved permit changes, the newest saved monitoring outcome, and project manager assignments appear in your team workspace.',
  items: [
    {
      id: 'permit-status-history',
      question: 'Where can my team view a permit’s saved status history?',
      answer:
        'An authorized member of the permit’s team can open the permit from the team dashboard and find Status history on its details page. It lists saved team status changes from oldest to newest, with the date and time each change was recorded. If there are no saved changes, the history says, “No status changes have been recorded yet.”',
    },
    {
      id: 'latest-monitoring-outcome',
      question: 'How does the Latest monitoring outcome filter work?',
      answer:
        'Use Latest monitoring outcome on the team permit list. All outcomes does not narrow the list by monitoring outcome. Successful matches a permit whose newest saved check has the result checked; Failed matches a newest saved check with any non-success result; and Not yet checked means no check has been saved for that permit. The filter reflects only each permit’s newest saved check. It does not establish live or continuous Tampa monitoring or confirm alert delivery.',
    },
    {
      id: 'assign-project-manager',
      question: 'Who can assign a project manager to a permit?',
      answer:
        'Only a team owner can change the assignment. On an active permit, the owner selects an eligible project manager from the assignment list and chooses Save assignment. An eligible manager has accepted membership as a project manager on that same team. A pending invitation, a member of another team, or a member with another role is not eligible.',
    },
  ],
  cta: null,
};
