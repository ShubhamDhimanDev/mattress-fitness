import type {ReactNode} from 'react';

/**
 * The cart page's warm paper background, scoped to the cart content and not the whole site (CR-31). The paper spreads sideways
 * with a box-shadow clipped to the element's own height: a shadow adds no scrollable width, so the page cannot gain a
 * horizontal scrollbar the way a 100vw element would. The bottom padding and its matching negative margin cover the shell
 * main's own bottom padding, so no white strip separates the paper from the footer.
 */
export function CartPageShell({children}: {children: ReactNode}) {
  return (
    <div className="relative -mb-12 bg-paper pt-6 pb-12 shadow-[0_0_0_100vmax_var(--color-paper)] [clip-path:inset(0_-100vmax)] md:pt-9">
      {children}
    </div>
  );
}
