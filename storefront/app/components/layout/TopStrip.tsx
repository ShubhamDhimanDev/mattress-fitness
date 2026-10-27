import type {ReactNode} from 'react';

type TopStripProps = {
  /** Hidden by default: the reference pattern uses this strip for a sister-brand link, which we do not have. */
  visible?: boolean;
  children?: ReactNode;
};

/** Optional slim strip above the utility bar. */
export function TopStrip({visible = false, children}: TopStripProps) {
  if (!visible || !children) return null;
  return (
    <div className="on-dark bg-ink-800 text-fg-inverse">
      <div className="mx-auto flex max-w-page items-center justify-center px-4 py-1 text-caption font-bold md:px-10">
        {children}
      </div>
    </div>
  );
}
