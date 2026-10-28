import {Form} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Input} from '~/components/ui/Input';

/**
 * The guest order-tracking form (REQ-ACC-003, P6-08). A plain POST form: it works without scripts, and with scripts
 * React Router sends the same POST and renders the answer in place. Nothing is read from the URL and nothing the
 * shopper typed is echoed back, so a link cannot pre-fill or trigger a lookup (T-09). The server validates again;
 * the attributes below only help the shopper.
 */
export function GuestOrderLookupForm({busy}: {busy: boolean}) {
  return (
    <Form method="post" action="/track-order" aria-label="Find your order">
      <Card variant="raised" className="flex flex-col gap-4">
        <Input
          name="orderNumber"
          label="Order number"
          hint="In your confirmation email, for example #1001."
          required
          maxLength={60}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Input
          name="email"
          type="email"
          label="Email address"
          hint="The address you used when you placed the order."
          required
          maxLength={254}
          autoComplete="email"
          spellCheck={false}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={busy}
          loadingLabel="Looking up your order"
        >
          Find my order
        </Button>
      </Card>
    </Form>
  );
}
