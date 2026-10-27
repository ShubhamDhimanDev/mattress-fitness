import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {InfoIcon} from '~/components/ui/Icons';

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
    <Card variant="tinted" className="flex flex-col gap-3">
      <h2
        id={headingId}
        className="flex items-center gap-2 text-lg font-extrabold"
      >
        <InfoIcon className="text-primary-700" />
        {title}
      </h2>
      <p>{message}</p>
      <div className="flex flex-wrap gap-3">
        <Button href="/account/login" variant="outline">
          Sign in to your account
        </Button>
      </div>
    </Card>
  );
}
