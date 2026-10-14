import type {ReactNode} from 'react';
import {Link} from 'react-router';
import type {AdminLink} from '~/lib/shopify/admin-link';

type AdminLinkActionProps = {
  link: AdminLink;
  className?: string;
  children: ReactNode;
};

/**
 * A link whose target was typed into Shopify admin. `parseAdminLink` has already limited it to a site path
 * or an https URL; paths use the router (no full reload), other sites open as plain anchors with
 * `noopener noreferrer`.
 */
export function AdminLinkAction({
  link,
  className,
  children,
}: AdminLinkActionProps) {
  if (link.external) {
    return (
      <a href={link.href} rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={link.href} prefetch="intent" className={className}>
      {children}
    </Link>
  );
}
