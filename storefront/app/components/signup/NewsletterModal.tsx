import {lazy, Suspense, useEffect, useState, type ComponentType} from 'react';
import {Dialog} from '~/components/ui/Dialog';
import {SiteImage} from '~/components/ui/SiteImage';
import {SITE_IMAGES} from '~/lib/site-images';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {
  PROMO_MIN_ORDER_NOTE,
  PROMO_PERCENT,
  type SignupPublicConfig,
} from '~/lib/signup/shared';

// Newsletter pop-up for the home page (CR-34): it asks for an email address so the team can send discount coupons. It
// reuses the signup form as is, so the explicit consent box, the honeypot, the rate limit and the "thank you" that does
// not reveal who is already subscribed all stay. The promo-code promise is written only when the server says the welcome email is on
// (`config.promo`); otherwise the team sends the coupon by hand and no amount is promised.
//
// Shown a few seconds after every load of the home page (owner request 2026-11-11: it used to show once, then stay quiet for two
// weeks). Nothing is stored in the browser any more. Closing it hides it until the home page is opened again.

const SHOW_AFTER_MS = 6000;

// The form is a lazy chunk, requested only once the pop-up opens. A chunk that cannot be downloaded leaves the dialog
// empty rather than breaking the page (NFR-013).
const NoSignup: ComponentType<SignupFormProps> = () => null;
const SignupForm = lazy(
  (): Promise<{default: ComponentType<SignupFormProps>}> =>
    import('~/components/signup/SignupForm').then(
      (module) => ({default: module.SignupForm}),
      () => ({default: NoSignup}),
    ),
);

export function NewsletterModal({config}: {config: SignupPublicConfig}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={
        config.promo ? (
          <>
            Save up to{' '}
            {/* The amount is what the shopper should see first: brand red on white (primary-600, 6.23 : 4.5) and the heaviest weight. */}
            <span className="font-black text-primary-600">
              {PROMO_PERCENT}% off
            </span>
          </>
        ) : (
          'Get discount coupons in your inbox'
        )
      }
      description={
        config.promo
          ? `Join our email list and we will email you a promo code right away, plus offers and sleep advice. ${PROMO_MIN_ORDER_NOTE}`
          : 'Join our email list and we will send you discount coupons, offers and sleep advice.'
      }
      closeLabel="Close newsletter sign-up"
      wide
    >
      {/* The photograph is decoration, so it is left out below `md` to keep the form in view on a phone. */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-stretch">
        <SiteImage
          image={SITE_IMAGES.newsletterSleeper}
          aspectRatio="351 / 503"
          sizes="(min-width: 768px) 280px, 0px"
          loading="lazy"
          className="hidden h-full w-full rounded-card object-cover md:block"
        />
        <Suspense fallback={null}>
          <SignupForm config={config} surface="modal" layout="bare" />
        </Suspense>
      </div>
    </Dialog>
  );
}
