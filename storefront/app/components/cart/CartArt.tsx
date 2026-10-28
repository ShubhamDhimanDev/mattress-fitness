import type {SVGProps} from 'react';
import {cn} from '~/components/ui/cn';

// Cart-only drawings. The shared icon set has no padlock, and the foundation step owns that file, so the two small
// pieces the cart needs live here. Both are decorative (aria-hidden): the control or heading beside them carries the words.

export function LockIcon({className, ...rest}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5 shrink-0', className)}
      {...rest}
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

/**
 * Empty-cart picture drawn inline (no image file exists yet, and a hard-coded asset must not stand in for client
 * content): a bed outline on a paper disc, in the neutral ink and paper tokens.
 */
export function EmptyCartArt({className}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('h-auto w-full max-w-xs', className)}
    >
      <ellipse cx="120" cy="140" rx="92" ry="10" className="fill-ink-100" />
      <rect
        x="36"
        y="92"
        width="168"
        height="30"
        rx="10"
        className="fill-surface stroke-ink-900"
        strokeWidth="3"
      />
      <rect
        x="36"
        y="64"
        width="20"
        height="58"
        rx="6"
        className="fill-paper stroke-ink-900"
        strokeWidth="3"
      />
      <rect
        x="64"
        y="68"
        width="44"
        height="22"
        rx="8"
        className="fill-paper stroke-ink-900"
        strokeWidth="3"
      />
      <path
        d="M120 92v-10a8 8 0 018-8h60a8 8 0 018 8v10"
        className="stroke-ink-900"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M52 122v14M188 122v14"
        className="stroke-ink-900"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="196" cy="34" r="9" className="fill-accent-400" />
      <circle cx="40" cy="40" r="4" className="fill-primary-500" />
      <circle cx="214" cy="62" r="3" className="fill-ink-300" />
    </svg>
  );
}
