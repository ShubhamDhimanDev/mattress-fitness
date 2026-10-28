import {useEffect, useRef, useState} from 'react';
import {Await, Link, useLocation, useNavigation} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {Aside, useAside} from '~/components/Aside';
import {LazyBoundary, PanelFailed} from '~/components/layout/LazyPanel';
import {cartPanel, mobileMenuPanel} from '~/components/layout/lazyPanels';
import {NavigationProgress} from '~/components/layout/NavigationProgress';
import {MAIN_CONTENT_ID} from '~/components/layout/SkipLink';
import {MobileMenuContent, SiteHeader} from '~/components/layout/SiteHeader';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {SpinnerIcon} from '~/components/ui/Icons';
import {Skeleton} from '~/components/ui/Skeleton';
import type {
  FooterLinks,
  MainNavItem,
  UtilityLink,
  PromoMessage,
  SupportPhone,
} from '~/lib/navigation';
import type {MyStoreSummary} from '~/lib/pages/my-store-summary';
import type {SignupPublicConfig} from '~/lib/signup/shared';

type PageLayoutProps = {
  cart: Promise<CartApiQueryFragment | null>;
  isLoggedIn: Promise<boolean>;
  /** The shopper's chosen store from the validated cookie, or null (REQ-LOC-003). */
  myStore?: MyStoreSummary | null;
  /** From the site_settings entry (lib/shopify/site-settings.ts, P3B-13); null hides the bar, nothing is invented (B-15). */
  promo?: PromoMessage | null;
  /** The main navigation from the Shopify admin menu (REQ-NAV-002); null shows the fixed navigation. */
  mainNav?: readonly MainNavItem[] | null;
  /** Footer links that depend on Shopify content, built by the root loader (REQ-CNT-001); none shows none of them. */
  footerLinks?: FooterLinks;
  /** The fixed navigation minus links to Shopify pages that do not exist, used when no admin menu is set (REQ-CNT-001). */
  fallbackNav?: readonly MainNavItem[] | null;
  /** The header and drawer utility links whose page exists (REQ-CNT-001). */
  utilityLinks?: readonly UtilityLink[];
  /** The client's number (PUBLIC_SUPPORT_PHONE or site_settings), or null: no phone link is rendered without one (REQ-CNT-001). */
  supportPhone?: SupportPhone | null;
  /** False when the deployment cannot save a ZIP; the header then offers no ZIP entry. */
  deliveryZipAvailable?: boolean;
  /** The footer's email signup (P7-02); null or absent renders nothing and requests no code. */
  signup?: SignupPublicConfig | null;
  children?: React.ReactNode;
};

/**
 * Site shell (REQ-NAV-001): header, one `main` landmark, footer, and the two side panels (cart and mobile
 * menu). The skip link is rendered by the root layout so it is first on every page, errors included.
 */
export function PageLayout({
  cart,
  isLoggedIn,
  myStore = null,
  promo = null,
  mainNav = null,
  footerLinks,
  fallbackNav = null,
  utilityLinks,
  supportPhone = null,
  deliveryZipAvailable = true,
  signup = null,
  children = null,
}: PageLayoutProps) {
  return (
    <Aside.Provider preload={ASIDE_PRELOAD}>
      <NavigationProgress />
      <SiteHeader
        cart={cart}
        isLoggedIn={isLoggedIn}
        promo={promo}
        mainNav={mainNav}
        fallbackNav={fallbackNav ?? undefined}
        utilityLinks={utilityLinks}
        storeName={myStore?.name ?? null}
        supportPhone={supportPhone}
        deliveryZipAvailable={deliveryZipAvailable}
      />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-page flex-1 px-4 pb-12 md:px-10"
      >
        {children}
      </main>
      <SiteFooter
        supportPhone={supportPhone}
        links={footerLinks}
        signup={signup}
      />
      <CartAside cart={cart} />
      <Aside type="mobile" heading="Menu" side="left">
        <MobileMenuContent
          mainNav={mainNav}
          supportPhone={supportPhone}
          fallbackNav={fallbackNav ?? undefined}
          utilityLinks={utilityLinks}
        />
      </Aside>
    </Aside.Provider>
  );
}

// Started when a panel is asked to open from anywhere (the add-to-cart buttons, the quiz result), so its chunk
// downloads while the cart request is still on its way (P7-06).
const ASIDE_PRELOAD = {
  cart: () => void cartPanel.preload(),
  mobile: () => void mobileMenuPanel.preload(),
};

const CartMainPanel = cartPanel.Panel;

/**
 * The item count for the drawer's title chip, read from the cart promise the page already has (no new request). It
 * is null until the cart arrives and when the cart failed, and the chip is then left out. It follows the server's
 * cart, not the optimistic one, so after an add it updates once the cart has been revalidated.
 */
function useCartItemCount(cart: PageLayoutProps['cart']): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    void cart.then(
      (resolved) => {
        if (current) setCount(resolved?.totalQuantity ?? 0);
      },
      () => {
        if (current) setCount(null);
      },
    );
    return () => {
      current = false;
    };
  }, [cart]);
  return count;
}

/**
 * The link to the cart page sits in the drawer's header. The drawer is a modal that lives in the root layout, so it would
 * otherwise stay open on top of the page it just opened. It does not close on the click, though: the cart page's loader
 * takes a moment on a slow connection, and a drawer that vanishes at once leaves the old page standing there with nothing
 * happening. Instead the link shows a spinner while the page loads and the drawer closes when the cart page has arrived.
 * Already on the cart page there is nothing to wait for, so it closes at once.
 */
function ViewFullCartLink() {
  const {close} = useAside();
  const location = useLocation();
  const navigation = useNavigation();
  const onCartPage = location.pathname === '/cart';
  // The drawer can be opened on the cart page itself; only an arrival that happens while it is open closes it.
  const openedOnCartPage = useRef(onCartPage);
  const pending =
    navigation.state !== 'idle' && navigation.location?.pathname === '/cart';

  useEffect(() => {
    if (onCartPage && !openedOnCartPage.current) close();
  }, [onCartPage, close]);

  return (
    <Link
      to="/cart"
      onClick={openedOnCartPage.current ? close : undefined}
      aria-busy={pending || undefined}
      className="inline-flex min-h-touch items-center gap-2 px-1 text-sm font-semibold text-fg-muted underline-offset-4 hover:text-fg hover:underline"
    >
      {pending ? <SpinnerIcon className="size-4" /> : null}
      View full cart
      {pending ? <span className="sr-only">, opening</span> : null}
    </Link>
  );
}

function CartAside({cart}: Pick<PageLayoutProps, 'cart'>) {
  const count = useCartItemCount(cart);
  return (
    <Aside
      type="cart"
      heading={
        count !== null && count > 0 ? `Your cart (${count})` : 'Your cart'
      }
      headerAction={<ViewFullCartLink />}
    >
      {/* The cart contents are a lazy chunk (P7-06); /cart, the no-JavaScript path, renders them statically. */}
      <LazyBoundary
        loading={<CartSkeleton />}
        failed={<PanelFailed href="/cart" linkText="Open the cart page" />}
      >
        <Await resolve={cart}>
          {(resolved) => <CartMainPanel cart={resolved} layout="aside" />}
        </Await>
      </LazyBoundary>
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
