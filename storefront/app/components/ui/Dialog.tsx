import {useId, type ReactNode, type RefObject} from 'react';
import {CloseIcon} from '~/components/ui/Icons';
import {IconButton} from '~/components/ui/IconButton';
import {Overlay} from '~/components/ui/Overlay';

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Short explanation under the title; wired as the dialog's description. */
  description?: ReactNode;
  children: ReactNode;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/** Centred modal for short tasks (ZIP entry, confirmations). Same focus and Escape behaviour as Drawer. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  closeLabel = 'Close',
  initialFocusRef,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      placement="center"
      initialFocusRef={initialFocusRef}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 pt-4 pr-2 pl-4">
        <div className="pt-2">
          <h2 id={titleId} className="type-display text-title">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton
          label={closeLabel}
          icon={<CloseIcon />}
          onClick={onClose}
          variant="soft"
          shape="round"
        />
      </div>
      <div className="min-h-0 overflow-y-auto p-4">{children}</div>
    </Overlay>
  );
}
