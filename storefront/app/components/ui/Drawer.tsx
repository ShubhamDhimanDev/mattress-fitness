import {useId, type ReactNode, type RefObject} from 'react';
import {CloseIcon} from '~/components/ui/Icons';
import {IconButton} from '~/components/ui/IconButton';
import {Overlay} from '~/components/ui/Overlay';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Visible heading; it is also the dialog's accessible name. */
  title: ReactNode;
  side?: 'left' | 'right';
  children: ReactNode;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Side panel for the cart and the mobile menu. Modal: focus is trapped, Escape closes, the page behind is
 * inert, and focus returns to the control that opened it. Content is only mounted while open.
 */
export function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  children,
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
      <div className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line pr-2 pl-4">
        <h2 id={titleId} className="type-display text-2xl">
          {title}
        </h2>
        <IconButton label={closeLabel} icon={<CloseIcon />} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </Overlay>
  );
}
