import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouteLoaderData} from 'react-router';
import {
  clearAccountQuiz,
  fetchAccountQuiz,
  pushAccountQuiz,
  type AccountFetchResult,
} from '~/lib/quiz/account-sync-client';
import type {SavedQuiz} from '~/lib/quiz/storage';

type SignedIn = 'unknown' | 'yes' | 'no';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Account side of the saved quiz result (REQ-QZ-005). The signed-in state is the root loader's deferred
 * `isLoggedIn`, so signed-out shoppers make no extra request at all. Every call fails soft: when the account
 * cannot be reached the device copy is all there is.
 */
export function useAccountQuizSync() {
  const root = useRouteLoaderData('root');
  const [signedIn, setSignedIn] = useState<SignedIn>('unknown');
  const signedInRef = useRef<SignedIn>('unknown');

  useEffect(() => {
    let cancelled = false;
    const pending = isRecord(root) ? root.isLoggedIn : undefined;
    void Promise.resolve(pending)
      .then((value): SignedIn => (value === true ? 'yes' : 'no'))
      .catch((): SignedIn => 'no')
      .then((next) => {
        if (cancelled) return;
        signedInRef.current = next;
        setSignedIn(next);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const load = useCallback(async (): Promise<AccountFetchResult> => {
    if (signedInRef.current !== 'yes') return {status: 'signed_out'};
    return fetchAccountQuiz(Date.now());
  }, []);

  const save = useCallback(async (saved: SavedQuiz): Promise<void> => {
    if (signedInRef.current !== 'yes') return;
    await pushAccountQuiz(saved);
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    if (signedInRef.current !== 'yes') return;
    await clearAccountQuiz();
  }, []);

  return {
    signedIn: signedIn === 'yes',
    known: signedIn !== 'unknown',
    load,
    save,
    clear,
  };
}
