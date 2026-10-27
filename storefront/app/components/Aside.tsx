import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {Drawer} from '~/components/ui/Drawer';

// Which side panel is open. The template's inline search panel is gone: search lives in the header now.
type AsideType = 'cart' | 'mobile' | 'closed';
type AsideContextValue = {
  type: AsideType;
  open: (mode: AsideType) => void;
  close: () => void;
};

/**
 * A side panel opened through the Aside context (`useAside().open('cart')`). Rendered with the shared
 * Drawer, so focus trap, Escape and focus return come from one place.
 * `countLabel`, `footer` and `bodyPadding` are passed straight to the Drawer (the count chip beside the title, a
 * pinned footer, edge-to-edge body).
 * @example
 * <Aside type="cart" heading="Your cart" countLabel="3 items"><CartMain ... /></Aside>
 */
export function Aside({
  children,
  heading,
  type,
  side = 'right',
  countLabel,
  footer,
  bodyPadding,
}: {
  children?: ReactNode;
  type: Exclude<AsideType, 'closed'>;
  heading: ReactNode;
  side?: 'left' | 'right';
  countLabel?: string;
  footer?: ReactNode;
  bodyPadding?: 'default' | 'none';
}) {
  const {type: activeType, close} = useAside();
  return (
    <Drawer
      open={type === activeType}
      onClose={close}
      title={heading}
      side={side}
      countLabel={countLabel}
      footer={footer}
      bodyPadding={bodyPadding}
    >
      {children}
    </Drawer>
  );
}

const AsideContext = createContext<AsideContextValue | null>(null);

Aside.Provider = function AsideProvider({
  children,
  preload,
}: {
  children: ReactNode;
  /** Called with the panel being opened, before it opens: the place to start downloading its lazy code. */
  preload?: Partial<Record<Exclude<AsideType, 'closed'>, () => void>>;
}) {
  const [type, setType] = useState<AsideType>('closed');
  const close = useCallback(() => setType('closed'), []);
  const open = useCallback(
    (mode: AsideType) => {
      if (mode !== 'closed') preload?.[mode]?.();
      setType(mode);
    },
    [preload],
  );
  const value = useMemo(() => ({type, open, close}), [type, open, close]);

  return (
    <AsideContext.Provider value={value}>{children}</AsideContext.Provider>
  );
};

export function useAside() {
  const aside = useContext(AsideContext);
  if (!aside) {
    throw new Error('useAside must be used within an AsideProvider');
  }
  return aside;
}
