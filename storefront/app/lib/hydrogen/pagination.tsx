// Cursor "Load more" pagination. Ported from @shopify/hydrogen 2026.4.7 (MIT), which dropped `<Pagination>` in 2026.10
// in favour of a collection store the project does not use (ADR-0012). Behaviour is unchanged: the next and previous
// links are real `?cursor=` links, and the pages already loaded are kept in the router's location state so the list
// grows in place.

import {
  createElement,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from 'react';
import {Link, useLocation, useNavigate, useNavigation} from 'react-router';
import {flattenConnection} from '@shopify/hydrogen';

type PageInfo = {
  startCursor?: string | null;
  endCursor?: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type Connection<NodeType> = {
  nodes: NodeType[];
  pageInfo: PageInfo;
};

type PaginationState<NodeType> = {
  pagination?: Record<
    string,
    {pageInfo: PageInfo; nodes: NodeType[]} | undefined
  >;
};

declare global {
  interface Window {
    __hydrogenHydrated?: boolean;
  }
}

type PaginationRenderProps<NodeType> = {
  state: unknown;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading: boolean;
  nextPageUrl: string;
  previousPageUrl: string;
  nodes: NodeType[];
  NextLink: LinkComponent;
  PreviousLink: LinkComponent;
};

type LinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, 'to'>;

/** A link to the next or previous page that keeps the loaded pages in the location state; renders nothing when off. */
function pageLink(options: {
  enabled: boolean;
  to: string;
  state: unknown;
  onClick: () => void;
}) {
  return forwardRef(function PageLink(
    props: LinkProps,
    ref: ForwardedRef<HTMLAnchorElement>,
  ) {
    return options.enabled
      ? createElement(Link, {
          preventScrollReset: true,
          ...props,
          to: options.to,
          state: options.state,
          replace: true,
          ref,
          onClick: options.onClick,
        })
      : null;
  });
}

type LinkComponent = ReturnType<typeof pageLink>;

function paramsWithoutPagination(
  search: string,
  state: PaginationState<unknown> | null,
): string {
  const params = new URLSearchParams(search);
  for (const namespace of Object.keys(state?.pagination ?? {})) {
    const prefix = namespace === '' ? '' : `${namespace}_`;
    params.delete(`${prefix}cursor`);
    params.delete(`${prefix}direction`);
  }
  return params.toString();
}

function usePagination<NodeType>(
  connection: Connection<NodeType>,
  namespace: string,
) {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const {state, search, pathname} = useLocation() as {
    state: PaginationState<NodeType> | null;
    search: string;
    pathname: string;
  };
  const cursorParam = namespace ? `${namespace}_cursor` : 'cursor';
  const directionParam = namespace ? `${namespace}_direction` : 'direction';
  const isPrevious =
    new URLSearchParams(search).get(directionParam) === 'previous';
  const kept = state?.pagination?.[namespace];

  const nodes = useMemo(() => {
    const current = flattenConnection(connection);
    if (!globalThis.window?.__hydrogenHydrated || !kept?.nodes) return current;
    return isPrevious
      ? [...current, ...kept.nodes]
      : [...kept.nodes, ...current];
  }, [kept, connection, isPrevious]);

  const pageInfo = useMemo(() => {
    const hydrated = globalThis.window?.__hydrogenHydrated;
    const info = kept?.pageInfo;
    let startCursor =
      !hydrated || info?.startCursor === undefined
        ? connection.pageInfo.startCursor
        : info.startCursor;
    let endCursor =
      !hydrated || info?.endCursor === undefined
        ? connection.pageInfo.endCursor
        : info.endCursor;
    let hasPreviousPage =
      !hydrated || info?.hasPreviousPage === undefined
        ? connection.pageInfo.hasPreviousPage
        : info.hasPreviousPage;
    let hasNextPage =
      !hydrated || info?.hasNextPage === undefined
        ? connection.pageInfo.hasNextPage
        : info.hasNextPage;
    if (kept?.nodes) {
      if (isPrevious) {
        startCursor = connection.pageInfo.startCursor;
        hasPreviousPage = connection.pageInfo.hasPreviousPage;
      } else {
        endCursor = connection.pageInfo.endCursor;
        hasNextPage = connection.pageInfo.hasNextPage;
      }
    }
    return {startCursor, endCursor, hasPreviousPage, hasNextPage};
  }, [isPrevious, kept, connection.pageInfo]);

  const urlRef = useRef({
    params: paramsWithoutPagination(search, state),
    pathname,
  });

  useEffect(() => {
    window.__hydrogenHydrated = true;
  }, []);

  useEffect(() => {
    const current = paramsWithoutPagination(search, state);
    const pathChanged = pathname !== urlRef.current.pathname;
    const paramsChanged = current !== urlRef.current.params;
    // Only clean up when the base URL or a non-pagination parameter changed, and not on the initial load.
    if (
      (pathChanged || paramsChanged) &&
      !(navigation.state === 'idle' && !navigation.location)
    ) {
      urlRef.current = {pathname, params: current};
      void navigate(`${pathname}?${current}`, {
        replace: true,
        preventScrollReset: true,
        state: {nodes: undefined, pageInfo: undefined},
      });
    }
  }, [
    pathname,
    search,
    state,
    navigate,
    navigation.state,
    navigation.location,
  ]);

  const previousPageUrl = useMemo(() => {
    const params = new URLSearchParams(search);
    params.set(directionParam, 'previous');
    if (pageInfo.startCursor) params.set(cursorParam, pageInfo.startCursor);
    return `?${params.toString()}`;
  }, [search, pageInfo.startCursor, directionParam, cursorParam]);

  const nextPageUrl = useMemo(() => {
    const params = new URLSearchParams(search);
    params.set(directionParam, 'next');
    if (pageInfo.endCursor) params.set(cursorParam, pageInfo.endCursor);
    return `?${params.toString()}`;
  }, [search, pageInfo.endCursor, directionParam, cursorParam]);

  return {...pageInfo, previousPageUrl, nextPageUrl, nodes};
}

export function Pagination<NodeType>({
  connection,
  children,
  namespace = '',
}: {
  connection: Connection<NodeType>;
  children: (props: PaginationRenderProps<NodeType>) => ReactNode;
  namespace?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const navigation = useNavigation();
  const location = useLocation() as {state: PaginationState<NodeType> | null};
  const {
    endCursor,
    hasNextPage,
    hasPreviousPage,
    nextPageUrl,
    nodes,
    previousPageUrl,
    startCursor,
  } = usePagination(connection, namespace);

  useEffect(() => {
    if (navigation.state === 'idle') setIsLoading(false);
  }, [navigation.state]);

  const state = useMemo(
    () => ({
      ...location.state,
      pagination: {
        ...(location.state?.pagination ?? {}),
        [namespace]: {
          pageInfo: {endCursor, hasPreviousPage, hasNextPage, startCursor},
          nodes,
        },
      },
    }),
    [
      endCursor,
      hasNextPage,
      hasPreviousPage,
      startCursor,
      nodes,
      namespace,
      location.state,
    ],
  );

  const NextLink = useMemo(
    () =>
      pageLink({
        enabled: hasNextPage,
        to: nextPageUrl,
        state,
        onClick: () => setIsLoading(true),
      }),
    [hasNextPage, nextPageUrl, state],
  );

  const PreviousLink = useMemo(
    () =>
      pageLink({
        enabled: hasPreviousPage,
        to: previousPageUrl,
        state,
        onClick: () => setIsLoading(true),
      }),
    [hasPreviousPage, previousPageUrl, state],
  );

  return children({
    state,
    hasNextPage,
    hasPreviousPage,
    isLoading,
    nextPageUrl,
    nodes,
    previousPageUrl,
    NextLink,
    PreviousLink,
  });
}
