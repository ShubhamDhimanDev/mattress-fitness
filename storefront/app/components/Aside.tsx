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
 * @example
 * <Aside type="cart" heading="Cart"><CartMain ... /></Aside>
 */
export function Aside({
  children,
  heading,
  type,
  side = 'right',
}: {
  children?: ReactNode;
  type: Exclude<AsideType, 'closed'>;
  heading: ReactNode;
  side?: 'left' | 'right';
}) {
  const {type: activeType, close} = useAside();
  return (
    <Drawer
      open={type === activeType}
      onClose={close}
      title={heading}
      side={side}
    >
      {children}
    </Drawer>
  );
}

const AsideContext = createContext<AsideContextValue | null>(null);

Aside.Provider = function AsideProvider({children}: {children: ReactNode}) {
  const [type, setType] = useState<AsideType>('closed');
  const close = useCallback(() => setType('closed'), []);
  const value = useMemo(() => ({type, open: setType, close}), [type, close]);

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
