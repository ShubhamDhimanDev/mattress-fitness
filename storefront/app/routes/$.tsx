import type {Route} from './+types/$';
import {RouteErrorPage} from '~/components/pages/ErrorPageView';

export async function loader({request}: Route.LoaderArgs) {
  throw new Response(`${new URL(request.url).pathname} not found`, {
    status: 404,
  });
}

export default function CatchAllPage() {
  return null;
}

/** The page for an address that matches nothing. The 404 status is set by the loader above. */
export function ErrorBoundary() {
  return <RouteErrorPage />;
}
