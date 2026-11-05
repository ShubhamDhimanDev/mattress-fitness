import {lazy, Suspense, useEffect, useState, type ComponentType} from 'react';
import {Dialog} from '~/components/ui/Dialog';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import type {SignupPublicConfig} from '~/lib/signup/shared';

// Newsletter pop-up for the home page (CR-34): it asks for an email address so the team can send discount coupons. It
// reuses the signup form as is, so the explicit consent box, the honeypot, the rate limit and the "thank you" that does
// not reveal who is already subscribed all stay. No amount or promise is written here: the offer itself is decided and
// sent by the team.
//
// Shown once, a few seconds after the page loads, then not again for two weeks on that browser. The date is kept in
// localStorage, which may be blocked or empty (private window): then the pop-up simply shows each visit and nothing breaks.

const SHOW_AFTER_MS = 6000;
const QUIET_DAYS = 14;
const STORAGE_KEY = 'newsletter-modal-shown';

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

/** True when this browser has not seen the pop-up within the quiet period. Pure apart from the storage it is given. */
export function shouldShowNewsletter(
  storage: Pick<Storage, 'getItem'> | null,
  now: number,
): boolean {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return true;
    const shownAt = Number(raw);
    if (!Number.isFinite(shownAt)) return true;
    return now - shownAt > QUIET_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function rememberShown(now: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    // Storage blocked: the pop-up may show again next visit. Nothing else depends on it.
  }
}

export function NewsletterModal({config}: {config: SignupPublicConfig}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    if (!shouldShowNewsletter(storage, Date.now())) return;
    const timer = window.setTimeout(() => {
      rememberShown(Date.now());
      setOpen(true);
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Get discount coupons in your inbox"
      description="Join our email list and we will send you discount coupons, offers and sleep advice."
      closeLabel="Close newsletter sign-up"
    >
      <Suspense fallback={null}>
        <SignupForm config={config} surface="modal" layout="bare" />
      </Suspense>
    </Dialog>
  );
}
