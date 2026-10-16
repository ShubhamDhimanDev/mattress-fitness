import type {CartMainProps} from '~/components/CartMain';
import {createLazyPanel} from '~/components/layout/LazyPanel';
import type {MobileNavProps} from '~/components/layout/MobileNav';
import type {SuggestionGroupsProps} from '~/components/layout/SuggestionGroups';
import type {ZipFormProps} from '~/components/layout/ZipForm';

// The panels that leave the entry bundle (P7-06). Only types are imported statically here; the components arrive
// through dynamic import so the bundler gives each its own chunk. The cart page (`routes/cart`) still imports
// CartMain statically, so that route keeps it in its own chunk, and the two share one file.

export const cartPanel = createLazyPanel<CartMainProps>(() =>
  import('~/components/CartMain').then((module) => module.CartMain),
);

export const mobileMenuPanel = createLazyPanel<MobileNavProps>(() =>
  import('~/components/layout/MobileNav').then((module) => module.MobileNav),
);

export const zipFormPanel = createLazyPanel<ZipFormProps>(() =>
  import('~/components/layout/ZipForm').then((module) => module.ZipForm),
);

export const suggestionsPanel = createLazyPanel<SuggestionGroupsProps>(() =>
  import('~/components/layout/SuggestionGroups').then(
    (module) => module.SuggestionGroups,
  ),
);
