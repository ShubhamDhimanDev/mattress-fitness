import {Suspense, useEffect, type ReactNode} from 'react';
import {Await, Link} from 'react-router';
import {useOptimisticCart} from '~/lib/hydrogen/cart-form';
import {type CartViewPayload, useAnalytics} from '~/lib/hydrogen/analytics';
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
import {TopStrip} from '~/components/layout/TopStrip';
import {UtilityBar} from '~/components/layout/UtilityBar';
import {Action} from '~/components/ui/Action';
import {CartIcon, MenuIcon, UserIcon} from '~/components/ui/Icons';
import {IconButton} from '~/components/ui/IconButton';
import {Skeleton} from '~/components/ui/Skeleton';
import {mainNavWithQuizCta} from '~/lib/nav-menu';
import {whenIdle} from '~/lib/when-idle';
import {DELIVERY_ERROR_TEXT} from '~/lib/delivery-runtime/response';
import {
  MAIN_NAV,
  SLEEP_QUIZ_LINK,
  type MainNavItem,
  type PromoMessage,
  type SupportPhone,
  type UtilityLink,
} from '~/lib/navigation';

type SiteHeaderProps = {
  /**
   * The navigation built from the Shopify admin menu (root loader, REQ-NAV-002). Null or empty means the fixed
   * the fixed navigation (without links to pages that may not exist) is shown instead.
   */
  mainNav?: readonly MainNavItem[] | null;
  cart: Promise<CartApiQueryFragment | null>;
  isLoggedIn: Promise<boolean>;
  promo?: PromoMessage | null;
  topStrip?: ReactNode;
  supportPhone?: SupportPhone | null;
  /** False in production when the ZIP cookie cannot be signed: a plain unavailable note replaces the control. */
  deliveryZipAvailable?: boolean;
  /** The fixed navigation without links to Shopify pages that do not exist (P6-09); used when no admin menu is set. */
  fallbackNav?: readonly MainNavItem[];
  /** Utility links whose page exists (P6-09); the default is the links that need no Shopify content. */
  utilityLinks?: readonly UtilityLink[];
};

/**
 * The header stack (REQ-NAV-001, CR-31), top to bottom: promotional bar, optional top strip, utility bar, main row
 * (menu button below 1024 px, logo, delivery-ZIP chip from 1024 px, search, account, cart), a ZIP strip below
 * 1024 px, the desktop navigation, the reassurance strip. Below 1024 px the navigation moves into a drawer behind
 * the menu button and the main row sticks to the top of the page.
 */
export function SiteHeader({
  cart,
  isLoggedIn,
  promo,
  topStrip,
  mainNav = null,
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

  const zipControl = (variant: 'chip' | 'strip') =>
    deliveryZipAvailable && delivery?.status !== 'service-unavailable' ? (
      <DeliveryZipControl
        variant={variant}
        zip={zip}
        onSubmit={(next) => void save(next)}
        onClear={() => void clear()}
        pending={pending}
        error={
          response?.error ? DELIVERY_ERROR_TEXT[response.error] : undefined
        }
      />
    ) : (
      <DeliveryZipUnavailable variant={variant} />
    );

  return (
    // From 1024 px the whole header is one block that scrolls away. Below it the header element generates no box
    // (`contents`), so the main row can stick to the top of the page while the bars above it scroll away: a sticky
    // element is held inside its parent, and the parent would otherwise end with the header. The element keeps its
    // banner role. `scroll-padding-top` in tailwind.css keeps focused elements clear of the sticky row (WCAG 2.4.11).
    <header className="contents lg:relative lg:z-30 lg:block lg:bg-surface">
      <PromoBar message={promo} />
      <TopStrip visible={Boolean(topStrip)}>{topStrip}</TopStrip>
      <UtilityBar supportPhone={supportPhone} links={utilityLinks} />

      <div className="sticky top-0 z-30 border-b border-line bg-surface lg:static">
        {/* From sm (640 px): three columns with the logo in the middle: the menu button on the left; the ZIP chip (from
            xl), account and cart on the right; below lg the search has its own full-width row. Below sm the 288 px logo
            leaves no room beside it, so it takes the first row alone and the second row holds menu, search, account and
            cart (the same two rows of height as before). */}
        <div className="relative mx-auto grid max-w-page grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4 md:gap-x-4 md:px-10 lg:py-3">
          <div className="col-start-1 row-start-2 sm:row-start-1 lg:hidden">
            <MobileMenuButton />
          </div>
          <div className="col-span-3 row-start-1 justify-self-center sm:col-span-1 sm:col-start-2">
            <HeaderLogo />
          </div>
          {/* From lg a compact copy of the search sits in the navigation row, left of the quiz button. Only one is
              displayed at a time (the hidden one is out of the accessibility tree). */}
          <div className="col-start-2 row-start-2 sm:col-span-3 sm:col-start-1 lg:hidden">
            <HeaderSearch />
          </div>
          <div className="col-start-3 row-start-2 flex items-center justify-end gap-1 sm:row-start-1 md:gap-3">
            <div className="hidden xl:block">{zipControl('chip')}</div>
            <AccountLink isLoggedIn={isLoggedIn} />
            <CartButton cart={cart} />
          </div>
        </div>
      </div>

      {/* The delivery ZIP and the quiz link for phones, tablets and small laptops; this row scrolls away under the sticky one. */}
      <div className="border-b border-line bg-paper xl:hidden">
        <div className="mx-auto flex max-w-page items-center gap-4 px-4 md:px-10">
          {zipControl('strip')}
          <Link
            to={SLEEP_QUIZ_LINK.to}
            className="inline-flex min-h-touch shrink-0 items-center lg:hidden text-caption font-extrabold text-primary-700 underline underline-offset-4 hover:text-primary-800"
          >
            {SLEEP_QUIZ_LINK.label}
          </Link>
        </div>
      </div>

      <div className="relative hidden border-b border-line lg:block">
        <MainNav items={navItems} trailing={<HeaderSearch compact />} />
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
      variant="soft"
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
    <Link
      to="/account"
      aria-label={label}
      className="inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center gap-2 rounded-choice px-2 text-base font-bold text-fg motion-safe:transition-colors hover:bg-paper"
    >
      <UserIcon />
      {/* The words show from lg; the link's accessible name is always the label above. */}
      <span aria-hidden="true" className="hidden lg:inline">
        {label}
      </span>
    </Link>
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
    <Action
      href="/cart"
      aria-label={label}
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
      // The 52 px paper tile with the count bubble on its corner (CR-31). The bubble is hidden from assistive
      // technology because the accessible name already carries the count.
      className="relative inline-flex size-11 shrink-0 md:size-13 items-center justify-center rounded-choice bg-paper text-fg motion-safe:transition-colors hover:bg-ink-100 active:bg-ink-200"
    >
      <CartIcon className="size-6.5" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-pill bg-primary-500 px-1 text-xs font-extrabold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Action>
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
