import {buttonStyles} from '~/components/ui/Button';
import {MapPinIcon} from '~/components/ui/Icons';

type StoreMapBlockProps = {
  name: string;
  addressLines: readonly string[];
  directionsUrl: string;
};

/**
 * Where the map goes. The interactive OpenStreetMap map (REQ-LOC-001, Q-010) is a later task, loads only
 * after the page is interactive and shows its attribution; until then this block is also the permanent
 * fallback the requirement asks for when the map cannot load: the address and a directions link. It adds no
 * map library and sends nothing to a third party.
 */
export function StoreMapBlock({
  name,
  addressLines,
  directionsUrl,
}: StoreMapBlockProps) {
  return (
    <section
      aria-labelledby="store-location-heading"
      className="flex flex-col gap-3 rounded-card border-2 border-line bg-surface-muted p-4"
    >
      <h2 id="store-location-heading" className="text-xl font-bold">
        Location
      </h2>
      <div className="flex items-start gap-3">
        <MapPinIcon className="mt-1 size-6 text-primary-700" />
        <address className="not-italic">
          <span className="block font-bold">{name}</span>
          {addressLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
      </div>
      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonStyles({size: 'md'}) + ' w-fit'}
      >
        Get directions
        <span className="sr-only"> (opens Google Maps in a new tab)</span>
      </a>
    </section>
  );
}
