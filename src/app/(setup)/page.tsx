// @polsia:user-owned — DocketKite public homepage.
import type { Metadata } from 'next';
import { AuthNav } from '@/components/custom/auth-nav';
import { BrandMark } from '@/components/custom/brand-mark';
import { Reveal } from '@/components/custom/motion-kit/reveal';
import { WaitlistForm } from '@/components/custom/waitlist-form';
import { siteDescription, siteName } from '@/lib/brand';
import { publicSocialImage, publicUrl } from '@/lib/public-origin';
import styles from './home.module.css';

const pageTitle = `${siteName} — City of Tampa permit checks`;
const canonical = publicUrl('/');
const socialImage = publicSocialImage(siteName);

export const metadata: Metadata = {
  title: { absolute: pageTitle },
  description: siteDescription,
  alternates: { canonical },
  openGraph: {
    title: pageTitle,
    description: siteDescription,
    url: canonical,
    type: 'website',
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle,
    description: siteDescription,
    images: [socialImage.url],
  },
};

function KiteMark() {
  return <BrandMark />;
}

function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return diagonal ? (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M5 15 15 5M6 5h9v9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M3.5 10h12m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="DocketKite home">
          <span className={styles.brandMark}>
            <KiteMark />
          </span>
          <span>
            Docket<span className={styles.brandLight}>Kite</span>
          </span>
        </a>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#workflow">How it works</a>
          <a href="#built-for">Who it’s for</a>
          <a href="#early-access">Early access</a>
          <a href="/pricing">Pricing</a>
          <a href="/contact">Contact us</a>
        </nav>
        <a className={styles.headerCta} href="#early-access">
          Join early access <ArrowIcon diagonal />
        </a>
        <div className={styles.accountActions}>
          <AuthNav />
        </div>
      </header>

      <p className={styles.sheetBar}>
        <span>Sheet 01</span>
        <span>Cover</span>
        <span>City of Tampa</span>
        <span>Residential remodel permits</span>
      </p>

      <section className={styles.hero} id="top">
        <Reveal as="div" trigger="load" distance={12} className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDot} /> City of Tampa permit coverage
          </p>
          <h1>
            Permit updates reach the jobsite <span>before the schedule slips.</span>
          </h1>
          <p className={styles.heroText}>
            DocketKite is for residential remodeling teams tracking City of Tampa permits. Team
            members can run an on-demand check of a linked public Accela record; successful checks
            keep the portal&apos;s raw record status separate from the team&apos;s own status.
            Checks are not scheduled, and SMS is planned but unavailable.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.buttonPrimary} href="#early-access">
              Join early access <ArrowIcon />
            </a>
            <a className={styles.buttonPrimary} href="/contact">
              Talk about a permit <ArrowIcon />
            </a>
            <a className={styles.textLink} href="#workflow">
              See the workflow{' '}
              <span>
                <ArrowIcon />
              </span>
            </a>
          </div>
          <p className={styles.buildNote}>
            <span /> Tampa city records only · checks start when a team member runs them
          </p>
          <a
            className={styles.textLink}
            href="https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building"
            target="_blank"
            rel="noreferrer"
          >
            Open the official City of Tampa Accela portal <ArrowIcon diagonal />
          </a>
        </Reveal>

        <div
          className={styles.heroVisual}
          role="img"
          aria-label="Diagram of an on-demand City of Tampa record check and team handoff"
        >
          <div className={styles.visualTopline}>
            <span className={styles.visualBrand}>
              <KiteMark /> DOCKETKITE
            </span>
            <span className={styles.visualLocation}>
              CITY OF TAMPA <span>↗</span>
            </span>
          </div>
          <div className={styles.visualMap} aria-hidden="true">
            <div className={styles.mapRoads} />
            <div className={styles.mapLabel}>CITY PERMIT PORTAL</div>
            <div className={styles.mapPin}>
              <span />
            </div>
            <svg aria-hidden="true" className={styles.mapRoute} viewBox="0 0 440 270" fill="none">
              <path
                d="M-12 205c60-2 64-65 122-64 56 0 54 57 113 46 51-9 48-80 100-78 45 2 61 39 126 20"
                stroke="#F0C14B"
                strokeWidth="2.5"
                strokeDasharray="5 7"
              />
              <circle cx="212" cy="187" r="6" fill="#F0C14B" stroke="#152033" strokeWidth="4" />
            </svg>
            <span className={styles.mapDistrict}>TAMPA</span>
          </div>
          <div className={styles.alertCard}>
            <div className={styles.alertCardHead}>
              <span className={styles.messageIcon}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 6.75A2.75 2.75 0 0 1 7.75 4h8.5A2.75 2.75 0 0 1 19 6.75v5.5A2.75 2.75 0 0 1 16.25 15H11l-4.5 4v-4.1A2.75 2.75 0 0 1 5 12.5V6.75Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className={styles.sampleLabel}>PORTAL FIELD</span>
              <span className={styles.sampleTime}>ON DEMAND</span>
            </div>
            <p className={styles.alertTitle}>Record Status</p>
            <div className={styles.alertType}>
              <span /> Raw public value
            </div>
            <p className={styles.alertBody}>
              A team member starts the check, and the permit number must match the City record.
            </p>
            <div className={styles.alertFoot}>
              <span className={styles.alertCheck}>✓</span> Kept separate from team notes
            </div>
          </div>
          <div className={styles.visualCaption}>
            <span className={styles.captionLine} /> A clearer handoff from portal to project manager
          </div>
        </div>
      </section>

      <div className={styles.signalBar}>
        <span className={styles.signalIntro}>MADE FOR THE WORK BETWEEN SUBMIT AND APPROVAL</span>
        <span>
          <b>01</b> One city: Tampa
        </span>
        <span>
          <b>02</b> For residential remodelers
        </span>
        <span>
          <b>03</b> Monitoring, not permit filing
        </span>
      </div>

      <section className={styles.problemSection} id="built-for">
        <div className={styles.problemHeading}>
          <p className={styles.eyebrow}>THE WAITING WINDOW</p>
          <h2>The gap after submission is where small delays hide.</h2>
        </div>
        <div className={styles.problemContent}>
          <div className={styles.timelineCard}>
            <div className={styles.timelineTop}>
              <span>THE PERMIT TIMELINE</span>
              <span className={styles.timelineTag}>A COMMON BLIND SPOT</span>
            </div>
            <div className={styles.timeline}>
              <div className={styles.timelineItem}>
                <span className={styles.timelineDotDone}>✓</span>
                <div>
                  <strong>Plans submitted</strong>
                  <small>The job moves into review</small>
                </div>
                <span className={styles.timelineState}>ON FILE</span>
              </div>
              <div className={styles.timelineStem} />
              <div className={styles.timelineItem}>
                <span className={styles.timelineDotAlert}>!</span>
                <div>
                  <strong>A city update posts</strong>
                  <small>Raw Record Status from the City page</small>
                </div>
                <span className={styles.timelineStateMuted}>EASY TO MISS</span>
              </div>
              <div className={styles.timelineStem} />
              <div className={styles.timelineItem}>
                <span className={styles.timelineDotIdle}>···</span>
                <div>
                  <strong>The team finds out</strong>
                  <small>When someone checks the portal</small>
                </div>
                <span className={styles.timelineStateMuted}>LATER</span>
              </div>
            </div>
            <p className={styles.timelineFoot}>
              A public status page helps when someone has time to look.
            </p>
          </div>
          <div className={styles.problemText}>
            <span className={styles.quoteMark}>“</span>
            <p>
              Your project manager has a jobsite to run. Repeated portal checks compete with the
              work happening right now.
            </p>
            <p>
              DocketKite is designed to make the next city update easier to catch, so the team can
              review the letter and plan a response sooner.
            </p>
            <a href="/contact" className={styles.inlineLink}>
              Tell us which permit is stuck <ArrowIcon diagonal />
            </a>
          </div>
        </div>
      </section>

      <section className={styles.workflowSection} id="workflow">
        <div className={styles.workflowIntro}>
          <p className={styles.eyebrow}>A SMALL, FOCUSED WORKFLOW</p>
          <h2>From a City record check to a clearer team handoff.</h2>
          <p>
            One city. The permit updates that matter. A simple handoff to the person coordinating
            the work.
          </p>
        </div>
        <div className={styles.steps}>
          <article className={styles.stepCard}>
            <div className={styles.stepMeta}>
              <span>01</span>
              <span className={styles.stepIcon}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4.75h9l5 5v9.5A.75.75 0 0 1 18.25 20h-12a.75.75 0 0 1-.75-.75v-14.5A.75.75 0 0 1 6.25 4h7.5M14 4v6h5M8 14h8m-8 3h5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
            <h3>List the permit</h3>
            <p>The team adds a City of Tampa permit and its direct public Accela record link.</p>
          </article>
          <article className={styles.stepCard}>
            <div className={styles.stepMeta}>
              <span>02</span>
              <span className={styles.stepIcon}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3.75v2m0 12.5v2m8.25-8.25h-2m-12.5 0h-2m14.09-5.84-1.42 1.42m-8.84 8.84-1.42 1.42m11.68 0-1.42-1.42m-8.84-8.84-1.42-1.42M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </div>
            <h3>Watch for movement</h3>
            <p>
              A team member starts an on-demand check. DocketKite records a status only when the
              public page confirms the permit number and shows its Record Status field.
            </p>
          </article>
          <article className={styles.stepCard}>
            <div className={styles.stepMeta}>
              <span>03</span>
              <span className={styles.stepIcon}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 6.75A2.75 2.75 0 0 1 7.75 4h8.5A2.75 2.75 0 0 1 19 6.75v5.5A2.75 2.75 0 0 1 16.25 15H11l-4.5 4v-4.1A2.75 2.75 0 0 1 5 12.5V6.75Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 8.5h6m-6 3h4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </div>
            <h3>Route a verified change</h3>
            <p>
              A verified status transition can email the assigned project manager; an interrupted
              check can email the team owner. Same-day SMS is planned and unavailable. Teams can
              upload a letter they can access, review extracted items, and create a checklist.
            </p>
          </article>
        </div>
        <p className={styles.workflowNote}>
          <span>CHECKS ARE ON DEMAND</span> No background schedule runs. Public correction-letter
          attachments were not confirmed in sampled records; secure files require an authorized
          contact. Teams can upload a letter they can access for reviewed extraction and checklists.
        </p>
      </section>

      <section className={styles.boundarySection}>
        <div className={styles.boundaryMark}>
          <KiteMark />
        </div>
        <div className={styles.boundaryCopy}>
          <p className={styles.eyebrow}>A CLEAR BOUNDARY</p>
          <h2>
            We surface the update.
            <br />
            <span>Your team handles the permit.</span>
          </h2>
          <p>
            DocketKite is for permit monitoring and coordination. It does not prepare, submit, or
            file permits with the City.
          </p>
        </div>
        <div className={styles.boundarySide}>
          <span className={styles.boundarySideLabel}>STARTING POINT</span>
          <strong>City of Tampa</strong>
          <span>Residential remodeling teams</span>
          <span className={styles.boundaryDivider} />
          <span className={styles.boundarySideLabel}>PLANNED OFFER</span>
          <strong>One useful text</strong>
          <span>For the project manager on the job</span>
        </div>
      </section>

      <section
        className={styles.contactSection}
        id="early-access"
        aria-labelledby="early-access-title"
      >
        <div className={styles.contactDecor} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className={styles.contactContent}>
          <p className={styles.eyebrow}>EARLY ACCESS · TAMPA ONLY</p>
          <h2 id="early-access-title">
            Run a residential remodeling company with City of Tampa permits?
          </h2>
          <p>
            Join the early-access list and help shape a permit follow-up workflow for your team.
          </p>
          <div className={styles.earlyAccessPlan}>
            <strong>PLANNED · NOT LIVE OR VERIFIED</strong>
            <p>
              Planned offer: a same-day project-manager text for a correction letter, hold, or
              approval, with a short checklist. SMS is unavailable today. Current checks are on
              demand and based on publicly visible record fields.
            </p>
          </div>
        </div>
        <div className={styles.contactAside}>
          <div className={styles.earlyAccessCard}>
            <p className={styles.earlyAccessLabel}>REQUEST EARLY ACCESS</p>
            <WaitlistForm
              classNames={{
                form: styles.waitlistForm,
                label: styles.waitlistLabel,
                input: styles.waitlistInput,
                button: styles.waitlistButton,
                error: styles.waitlistError,
                status: styles.waitlistStatus,
              }}
            />
            <p className={styles.earlyAccessNote}>
              We’ll use your email to contact you about DocketKite early access.
            </p>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <a className={styles.brand} href="#top" aria-label="DocketKite home">
          <span className={styles.brandMark}>
            <KiteMark />
          </span>
          <span>
            Docket<span className={styles.brandLight}>Kite</span>
          </span>
        </a>
        <p>
          Permit updates reach the jobsite before the schedule slips.{' '}
          <a className={styles.footerCompare} href="/compare">
            See the City of Tampa portal and coverage notes
          </a>
          {' · '}
          <a className={styles.footerCompare} href="/pricing">
            View team pricing
          </a>
          {' · '}
          <a className={styles.footerCompare} href="/faq">
            Read the DocketKite FAQ
          </a>
        </p>
        <a href="/contact" className={styles.footerEmail}>
          Contact us <ArrowIcon diagonal />
        </a>
        <span className={styles.copyright}>© {new Date().getFullYear()} DocketKite</span>
      </footer>
    </main>
  );
}
