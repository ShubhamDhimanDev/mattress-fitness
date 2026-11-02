import {Button} from '~/components/ui/Button';
import {PhoneIcon} from '~/components/ui/Icons';
import {
  BUSINESS_ADDRESS,
  BUSINESS_PHONE,
  directionsUrl,
  mapEmbedUrl,
} from '~/lib/business';

const HEADING_ID = 'visit-heading';

/**
 * "Visit our store" at the foot of the home page: the address, the phone and a large map (lib/business.ts). It is
 * fixed content of the project, not an admin block, and it is the only place the map appears. The map is an
 * OpenStreetMap frame, the one third-party frame the CSP allows (`MAP_FRAME_ORIGIN`); it is lazy, so it is requested
 * only when this section nears the screen, and the directions button works without it.
 */
export function VisitSection() {
  const address = BUSINESS_ADDRESS.lines.join(', ');
  return (
    <section
      aria-labelledby={HEADING_ID}
      className="grid gap-8 rounded-hero bg-paper px-4 py-11 md:gap-12 md:px-12 md:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center"
    >
      <div className="flex min-w-0 flex-col items-start gap-5">
        <h2
          id={HEADING_ID}
          className="type-display text-3xl text-balance md:text-heading"
        >
          Visit our <span className="type-mark">store.</span>
        </h2>
        <address className="flex flex-col text-lead text-fg-muted not-italic">
          {BUSINESS_ADDRESS.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </address>
        <div className="flex flex-wrap gap-3">
          <Button href={BUSINESS_PHONE.href} size="lg">
            <PhoneIcon className="size-5" />
            <span className="sr-only">Call us: </span>
            {BUSINESS_PHONE.display}
          </Button>
          <Button
            href={directionsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="lg"
          >
            Get directions
            <span className="sr-only"> (opens in a new tab)</span>
          </Button>
        </div>
      </div>
      <iframe
        src={mapEmbedUrl()}
        title={`Map showing the store at ${address}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="aspect-4/3 w-full rounded-hero border-0 bg-surface md:aspect-16/10"
      />
    </section>
  );
}
