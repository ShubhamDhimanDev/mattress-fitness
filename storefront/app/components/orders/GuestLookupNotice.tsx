import {Button} from '~/components/ui/Button';

/**
 * Every unsuccessful answer: the generic "not found" (which also covers a wrong email, a bad format, an order older
 * than 60 days and an upstream failure, so it says none of those), the rate-limit notice and the unavailable notice.
 * The text comes from the server and is fixed; nothing the shopper typed is shown (REQ-ACC-003, T-09).
 */
export function GuestLookupNotice({
  title,
  message,
  headingId,
}: {
  title: string;
  message: string;
  headingId: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-4">
      <h2 id={headingId} className="text-base font-bold">
        {title}
      </h2>
      <p>{message}</p>
      <div className="flex flex-wrap gap-3">
        <Button href="/account/login" variant="secondary">
          Sign in to your account
        </Button>
      </div>
    </div>
  );
}
