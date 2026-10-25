import {Await} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {Aside} from '~/components/Aside';
import {LazyBoundary, PanelFailed} from '~/components/layout/LazyPanel';
import {cartPanel, mobileMenuPanel} from '~/components/layout/lazyPanels';
import {MAIN_CONTENT_ID} from '~/components/layout/SkipLink';
import {MobileMenuContent, SiteHeader} from '~/components/layout/SiteHeader';
import {SiteFooter} from '~/components/layout/SiteFooter';
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
        className="mx-auto w-full max-w-page flex-1 px-4 pb-12 md:px-6"
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

function CartAside({cart}: Pick<PageLayoutProps, 'cart'>) {
  return (
    <Aside type="cart" heading="Cart">
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
