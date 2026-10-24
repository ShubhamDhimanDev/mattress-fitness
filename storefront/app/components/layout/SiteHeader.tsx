import {Suspense, useEffect, type ReactNode} from 'react';
import {Await, Link} from 'react-router';
import {
  type CartViewPayload,
  useAnalytics,
  useOptimisticCart,
} from '@shopify/hydrogen';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {useDeliveryZip} from '~/components/delivery/useDeliveryZip';
import {
  DeliveryZipControl,
  DeliveryZipUnavailable,
} from '~/components/layout/DeliveryZipControl';
import {HeaderLogo} from '~/components/layout/BrandLogo';
import {HeaderSearch} from '~/components/layout/HeaderSearch';
import {MainNav} from '~/components/layout/MainNav';
import {LazyBoundary, PanelFailed} from '~/components/layout/LazyPanel';
import {cartPanel, mobileMenuPanel} from '~/components/layout/lazyPanels';
import {PromoBar} from '~/components/layout/PromoBar';
import {ReassuranceStrip} from '~/components/layout/ReassuranceStrip';
import {StoreSelectorLink} from '~/components/layout/StoreSelectorLink';
import {TopStrip} from '~/components/layout/TopStrip';
import {UtilityBar} from '~/components/layout/UtilityBar';
import {CartIcon, MapPinIcon, MenuIcon, UserIcon} from '~/components/ui/Icons';
import {IconButton} from '~/components/ui/IconButton';
import {Skeleton} from '~/components/ui/Skeleton';
import {mainNavWithQuizCta} from '~/lib/nav-menu';
import {whenIdle} from '~/lib/when-idle';
import {DELIVERY_ERROR_TEXT} from '~/lib/delivery-runtime/response';
import {
  MAIN_NAV,
  SLEEP_QUIZ_LINK,
  STORE_LOCATOR_PATH,
  type MainNavItem,
  type PromoMessage,
  type SupportPhone,
  type UtilityLink,
} from '~/lib/navigation';

type SiteHeaderProps = {
  /**
   * The navigation built from the Shopify admin menu (root loader, REQ-NAV-002). Null or empty means the fixed
   * `MAIN_NAV` is shown instead.
   */
  mainNav?: readonly MainNavItem[] | null;
  cart: Promise<CartApiQueryFragment | null>;
  isLoggedIn: Promise<boolean>;
  promo?: PromoMessage | null;
  topStrip?: ReactNode;
  /** Name of the shopper's chosen store, read from the validated my_store cookie by the root loader (P3B-10). */
  storeName?: string | null;
  supportPhone?: SupportPhone | null;
  /** False in production when the ZIP cookie cannot be signed: a plain unavailable note replaces the control. */
  deliveryZipAvailable?: boolean;
  /** The fixed navigation without links to Shopify pages that do not exist (P6-09); used when no admin menu is set. */
  fallbackNav?: readonly MainNavItem[];
  /** Utility links whose page exists (P6-09); the default is the links that need no Shopify content. */
  utilityLinks?: readonly UtilityLink[];
};

/**
 * The header stack (REQ-NAV-001), top to bottom: promotional bar, optional top strip, utility bar, main row
 * (logo, search, store locator, account, cart), desktop navigation, reassurance strip. Below 1024 px the
 * navigation moves into a drawer behind the menu button and the main row becomes two rows.
 */
export function SiteHeader({
  cart,
  isLoggedIn,
  promo,
  topStrip,
  mainNav = null,
  storeName = null,
  supportPhone = null,
  deliveryZipAvailable = true,
  fallbackNav = MAIN_NAV,
  utilityLinks,
}: SiteHeaderProps) {
  const navItems = mainNavWithQuizCta(mainNav, fallbackNav);
  // The saved ZIP lives in a signed cookie that only the server reads (P3B-11). The root loader hands the
  // answer down with the page, so the first paint is right; the hook shares it with the product-page and cart
  // delivery check, so the header and those agree.
  const {response, pending, save, clear} = useDeliveryZip();
  const delivery = response?.delivery;
  // A ZIP shows only when the server resolved it; with no delivery zone configured the header says nothing.
  const zip =
    delivery?.status === 'in-zone' || delivery?.status === 'outside-zone'
      ? delivery.zip
      : null;

  return (
    <header className="relative z-30 bg-surface">
      <PromoBar message={promo} />
      <TopStrip visible={Boolean(topStrip)}>{topStrip}</TopStrip>
      <UtilityBar supportPhone={supportPhone} links={utilityLinks}>
        {deliveryZipAvailable && delivery?.status !== 'service-unavailable' ? (
          <DeliveryZipControl
            zip={zip}
            onSubmit={(next) => void save(next)}
            onClear={() => void clear()}
            pending={pending}
            error={
              response?.error ? DELIVERY_ERROR_TEXT[response.error] : undefined
            }
          />
        ) : (
          <DeliveryZipUnavailable />
        )}
        <StoreSelectorLink storeName={storeName} />
      </UtilityBar>

      <div className="border-b border-line">
        <div className="relative mx-auto grid max-w-page grid-cols-[auto_1fr_auto_auto] items-center gap-x-1 gap-y-1 px-4 py-2 md:px-6 lg:grid-cols-[auto_1fr_auto_auto_auto] lg:gap-x-4">
          <div className="col-span-2 col-start-1 row-start-1 flex lg:col-span-1">
            <HeaderLogo />
          </div>
          <div className="col-span-2 col-start-3 row-start-1 justify-self-end lg:hidden">
            <Link
              to={SLEEP_QUIZ_LINK.to}
              className="inline-flex min-h-touch items-center text-sm font-bold text-primary-700 underline underline-offset-4 hover:text-primary-800"
            >
              {SLEEP_QUIZ_LINK.label}
            </Link>
          </div>
          <div className="col-start-1 row-start-2 lg:hidden">
            <MobileMenuButton />
          </div>
          {/* From lg the search is capped and pushed to the right, so a wide screen does not stretch it (BA-04). */}
          <div className="col-start-2 row-start-2 min-w-0 lg:row-start-1 lg:w-full lg:max-w-xl lg:justify-self-end">
            <HeaderSearch />
          </div>
          <div className="hidden lg:col-start-3 lg:row-start-1 lg:block">
            <IconButton
              to={STORE_LOCATOR_PATH}
              label="Find a store"
              caption="Stores"
              icon={<MapPinIcon />}
            />
          </div>
          <div className="col-start-3 row-start-2 lg:col-start-4 lg:row-start-1">
            <AccountLink isLoggedIn={isLoggedIn} />
          </div>
          <div className="col-start-4 row-start-2 lg:col-start-5 lg:row-start-1">
            <CartButton cart={cart} />
          </div>
        </div>
      </div>

      <div className="relative hidden border-b border-line lg:block">
        <MainNav items={navItems} />
      </div>

      <ReassuranceStrip />
    </header>
  );
}

function MobileMenuButton() {
  const {open} = useAside();
  return (
    <IconButton
      label="Menu"
      icon={<MenuIcon />}
      aria-haspopup="dialog"
      onClick={() => open('mobile')}
      // The menu's chunk starts downloading on intent, so it is ready when the drawer opens (P7-06).
      onPointerEnter={() => void mobileMenuPanel.preload()}
      onFocus={() => void mobileMenuPanel.preload()}
      onPointerDown={() => void mobileMenuPanel.preload()}
    />
  );
}

function AccountLink({isLoggedIn}: Pick<SiteHeaderProps, 'isLoggedIn'>) {
  return (
    <Suspense fallback={<AccountButton signedIn={false} />}>
      <Await
        resolve={isLoggedIn}
        errorElement={<AccountButton signedIn={false} />}
      >
        {(signedIn) => <AccountButton signedIn={signedIn} />}
      </Await>
    </Suspense>
  );
}

function AccountButton({signedIn}: {signedIn: boolean}) {
  const label = signedIn ? 'Account' : 'Sign in';
  return (
    <IconButton
      to="/account"
      label={label}
      caption={label}
      icon={<UserIcon />}
    />
  );
}

function CartButton({cart}: Pick<SiteHeaderProps, 'cart'>) {
  return (
    <Suspense fallback={<CartLink count={0} />}>
      <Await resolve={cart} errorElement={<CartLink count={0} />}>
        {(resolved) => <OptimisticCartLink cart={resolved} />}
      </Await>
    </Suspense>
  );
}

function OptimisticCartLink({cart}: {cart: CartApiQueryFragment | null}) {
  // Applies pending cart actions so the count reacts before the server answers.
  const optimistic = useOptimisticCart(cart);
  return <CartLink count={optimistic?.totalQuantity ?? 0} />;
}

function CartLink({count}: {count: number}) {
  const {open} = useAside();
  const {publish, shop, cart, prevCart} = useAnalytics();
  const label =
    count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart';

  // A shopper with items in the cart is likely to open the drawer: fetch its chunk in idle time (P7-06). An
  // empty cart waits for intent (pointer, focus) or the open itself.
  const hasItems = count > 0;
  useEffect(() => {
    if (!hasItems) return;
    return whenIdle(() => void cartPanel.preload());
  }, [hasItems]);

  return (
    // A real link to /cart, so the cart is reachable without JavaScript; with JavaScript it opens the drawer.
    <IconButton
      href="/cart"
      label={label}
      caption="Cart"
      badge={count}
      icon={<CartIcon />}
      aria-haspopup="dialog"
      onPointerEnter={() => void cartPanel.preload()}
      onFocus={() => void cartPanel.preload()}
      onPointerDown={() => void cartPanel.preload()}
      onClick={(event) => {
        event.preventDefault();
        open('cart');
        publish('cart_viewed', {
          cart,
          prevCart,
          shop,
          url: window.location.href || '',
        } as CartViewPayload);
      }}
    />
  );
}

const MobileNavPanel = mobileMenuPanel.Panel;

/**
 * Content of the mobile menu drawer; rendered by PageLayout inside the 'mobile' aside. The navigation arrives
 * as a lazy chunk (P7-06); the fallback is about as tall as the first screen of the real list.
 */
export function MobileMenuContent({
  mainNav = null,
  supportPhone = null,
  fallbackNav = MAIN_NAV,
  utilityLinks,
}: {
  mainNav?: readonly MainNavItem[] | null;
  supportPhone?: SupportPhone | null;
  fallbackNav?: readonly MainNavItem[];
  utilityLinks?: readonly UtilityLink[];
}) {
  const {close} = useAside();
  const navItems = mainNavWithQuizCta(mainNav, fallbackNav);
  return (
    <LazyBoundary
      loading={<MobileNavSkeleton items={navItems} />}
      failed={
        <PanelFailed href="/collections" linkText="Browse all products" />
      }
    >
      <MobileNavPanel
        items={navItems}
        onNavigate={close}
        supportPhone={supportPhone}
        utilityLinks={utilityLinks}
      />
    </LazyBoundary>
  );
}

function MobileNavSkeleton({items}: {items: readonly MainNavItem[]}) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading menu</span>
      {items.map((item) => (
        <Skeleton key={item.id} className="h-11 w-full" />
      ))}
    </div>
  );
}
