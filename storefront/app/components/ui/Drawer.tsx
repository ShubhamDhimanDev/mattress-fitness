import {useId, type ReactNode, type RefObject} from 'react';
import {Chip} from '~/components/ui/Chip';
import {cn} from '~/components/ui/cn';
import {CloseIcon} from '~/components/ui/Icons';
import {IconButton} from '~/components/ui/IconButton';
import {Overlay} from '~/components/ui/Overlay';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Visible heading; it is also the dialog's accessible name. */
  title: ReactNode;
  /** Text of the small count chip beside the title, e.g. "3 items". Omit for no chip. */
  countLabel?: string;
  side?: 'left' | 'right';
  children: ReactNode;
  /**
   * Pinned under the scrolling body with a hairline above it (cart subtotal and checkout buttons). It stays in
   * view while the lines scroll.
   */
  footer?: ReactNode;
  /** `none` lets the body run edge to edge (a list of cards that brings its own spacing). */
  bodyPadding?: 'default' | 'none';
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Side panel for the cart and the mobile menu: up to 440 px wide, deep shadow, a header with the title, an optional
 * count chip and a round 44 px close button. Modal: focus is trapped, Escape closes, the page behind is inert, and focus
 * returns to the control that opened it. Content is only mounted while open.
 */
export function Drawer({
  open,
  onClose,
  title,
  countLabel,
  side = 'right',
  children,
  footer,
  bodyPadding = 'default',
  closeLabel = 'Close',
  initialFocusRef,
}: DrawerProps) {
  const titleId = useId();
  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      placement={side}
      initialFocusRef={initialFocusRef}
    >
      <div className="flex min-h-18 shrink-0 items-center justify-between gap-4 border-b border-line py-2 pr-3 pl-5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id={titleId} className="type-display text-2xl">
            {title}
          </h2>
          {countLabel ? <Chip>{countLabel}</Chip> : null}
        </div>
        <IconButton
          label={closeLabel}
          icon={<CloseIcon />}
          onClick={onClose}
          variant="soft"
          shape="round"
        />
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          bodyPadding === 'default' && 'p-4',
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-line bg-surface p-4">
          {footer}
        </div>
      ) : null}
    </Overlay>
  );
}
