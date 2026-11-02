import {BUSINESS_ADDRESS, directionsUrl, mapEmbedUrl} from '~/lib/business';

/**
 * The store's position on an OpenStreetMap window (lib/business.ts), with a link that opens the route in the visitor's
 * maps app. The frame is lazy, so it is requested only when the footer comes near the screen; it is the one
 * third-party frame the CSP allows (`MAP_FRAME_ORIGIN`). The link is also the way in for a visitor whose browser
 * blocks the frame.
 */
export function StoreMap({linkClassName}: {linkClassName: string}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-start gap-1">
      <iframe
        src={mapEmbedUrl()}
        title={`Map showing the store at ${BUSINESS_ADDRESS.lines.join(', ')}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="aspect-4/3 w-full rounded-card border-0 bg-ink-800"
      />
      <a
        href={directionsUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        Get directions
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}
