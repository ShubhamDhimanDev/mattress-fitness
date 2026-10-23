import type {AnchorHTMLAttributes} from 'react';
import {Link} from 'react-router';

type NavAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  /** An https URL on another site (a Shopify menu link): a plain anchor, not a router link. */
  external?: boolean;
};

/**
 * A navigation link: the client-side router for our own pages, a plain anchor for the rare link to another site
 * that the client put in the Shopify menu. Same classes and key handling either way.
 */
export function NavAnchor({
  to,
  external = false,
  children,
  ...rest
}: NavAnchorProps) {
  if (external) {
    return (
      <a href={to} rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
}
