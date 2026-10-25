import {lazy, Suspense, type ComponentType} from 'react';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {Skeleton} from '~/components/ui/Skeleton';

// The only part of the signup that is in a route's initial JavaScript (bundle budget, scripts/perf, DEC-101): a lazy
// import and a Suspense boundary. The form itself is its own chunk, requested only where a form is rendered, which is
// nowhere when the signup is not configured (the root loader then passes no config and the caller renders nothing).
//
// A chunk that cannot be downloaded (offline, a deploy replaced the file, an ad blocker) hides the form and nothing
// else: a rejected lazy import would otherwise throw into the page (NFR-013). The page keeps working; a reload retries.
const Nothing: ComponentType<SignupFormProps> = () => null;
const SignupForm = lazy(
  (): Promise<{default: ComponentType<SignupFormProps>}> =>
    import('~/components/signup/SignupForm').then(
      (module) => ({default: module.SignupForm}),
      () => ({default: Nothing}),
    ),
);

export function SignupSlot(props: SignupFormProps) {
  return (
    // The placeholder is about the form's height on a phone, so a late arrival moves little. It is hidden from
    // assistive technology (Skeleton is aria-hidden); the form announces itself when it appears.
    <Suspense fallback={<Skeleton className="h-72 w-full max-w-xl" />}>
      <SignupForm {...props} />
    </Suspense>
  );
}
