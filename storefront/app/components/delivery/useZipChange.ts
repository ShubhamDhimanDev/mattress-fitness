import {useSyncExternalStore} from 'react';
import {
  currentZipChange,
  NO_ZIP_CHANGE,
  subscribeZipChange,
  type ZipChange,
} from '~/lib/delivery-runtime/zip-change';

/** The record of ZIP changes in this page session (zip-change.ts). Empty on the server and during hydration. */
export function useZipChange(): ZipChange {
  return useSyncExternalStore(
    subscribeZipChange,
    currentZipChange,
    () => NO_ZIP_CHANGE,
  );
}
