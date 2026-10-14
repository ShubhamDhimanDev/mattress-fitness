import {Form} from 'react-router';
import {Button} from '~/components/ui/Button';

type MyStoreControlProps = {
  /** The store key (`state.city.store`) the action validates against the known list. */
  storeKey: string;
  /** Names the target for screen readers when several controls share a page. */
  storeName: string;
  isMine: boolean;
  compact?: boolean;
};

/**
 * "Set as my store" and "Clear" (REQ-LOC-003). A plain POST to the /stores action, so it works without
 * JavaScript; the server checks the key against the store list, sets the cookie and redirects back.
 */
export function MyStoreControl({
  storeKey,
  storeName,
  isMine,
  compact = false,
}: MyStoreControlProps) {
  return (
    <Form method="post" action="/stores" preventScrollReset>
      <input type="hidden" name="store" value={storeKey} />
      {isMine ? (
        <Button
          type="submit"
          name="intent"
          value="clear"
          variant="ghost"
          size="sm"
        >
          Clear my store
        </Button>
      ) : (
        <Button
          type="submit"
          name="intent"
          value="set"
          variant={compact ? 'primary' : 'accent'}
          size={compact ? 'sm' : 'md'}
        >
          Set as my store
          <span className="sr-only"> ({storeName})</span>
        </Button>
      )}
    </Form>
  );
}
