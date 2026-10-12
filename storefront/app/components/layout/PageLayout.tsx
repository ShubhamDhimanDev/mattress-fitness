import {Suspense} from 'react';
import {Await} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {Aside} from '~/components/Aside';
import {CartMain} from '~/components/CartMain';
import {MAIN_CONTENT_ID} from '~/components/layout/SkipLink';
import {MobileMenuContent, SiteHeader} from '~/components/layout/SiteHeader';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {Skeleton} from '~/components/ui/Skeleton';
import {DEFAULT_PROMO} from '~/lib/navigation';

type PageLayoutProps = {
  cart: Promise<CartApiQueryFragment | null>;
  isLoggedIn: Promise<boolean>;
  children?: React.ReactNode;
};

/**
 * Site shell (REQ-NAV-001): header, one `main` landmark, footer, and the two side panels (cart and mobile
 * menu). The skip link is rendered by the root layout so it is first on every page, errors included.
 */
export function PageLayout({
  cart,
  isLoggedIn,
  children = null,
}: PageLayoutProps) {
  return (
    <Aside.Provider>
      {/* TODO(P3B-13): the promotion text comes from Shopify admin; this placeholder keeps the bar visible. */}
      <SiteHeader cart={cart} isLoggedIn={isLoggedIn} promo={DEFAULT_PROMO} />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-page flex-1 px-4 pb-12 md:px-6"
      >
        {children}
      </main>
      <SiteFooter />
      <CartAside cart={cart} />
      <Aside type="mobile" heading="Menu" side="left">
        <MobileMenuContent />
      </Aside>
    </Aside.Provider>
  );
}

function CartAside({cart}: Pick<PageLayoutProps, 'cart'>) {
  return (
    <Aside type="cart" heading="Cart">
      <Suspense fallback={<CartSkeleton />}>
        <Await resolve={cart}>
          {(resolved) => <CartMain cart={resolved} layout="aside" />}
        </Await>
      </Suspense>
    </Aside>
  );
}

function CartSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading cart</span>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
