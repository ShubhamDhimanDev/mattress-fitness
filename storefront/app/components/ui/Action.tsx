import {Link, type LinkProps} from 'react-router';
import type {ComponentPropsWithoutRef, ReactNode} from 'react';

// One element that is a <button>, a client-side router link or a plain anchor depending on the props.
// Button and IconButton share it so "renders a link when given `to` or `href`" behaves the same everywhere.
type OwnProps = {className?: string; children?: ReactNode};

type AsButton = Omit<ComponentPropsWithoutRef<'button'>, keyof OwnProps> & {
  to?: undefined;
  href?: undefined;
};
type AsRouterLink = Omit<LinkProps, keyof OwnProps | 'to'> & {
  to: LinkProps['to'];
  href?: undefined;
};
type AsAnchor = Omit<ComponentPropsWithoutRef<'a'>, keyof OwnProps | 'href'> & {
  href: string;
  to?: undefined;
};

export type ActionElementProps = AsButton | AsRouterLink | AsAnchor;

type ActionProps = ActionElementProps & {
  className: string;
  children: ReactNode;
  /** True while the action must not fire (loading or disabled) but should stay focusable. */
  inert?: boolean;
};

export function Action({
  className,
  children,
  inert = false,
  ...element
}: ActionProps) {
  if (element.to !== undefined) {
    const {to, onClick, ...rest} = element;
    return (
      <Link
        {...rest}
        to={to}
        className={className}
        aria-disabled={inert || undefined}
        onClick={(event) => {
          if (inert) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {children}
      </Link>
    );
  }

  if (element.href !== undefined) {
    const {href, onClick, ...rest} = element;
    return (
      <a
        {...rest}
        href={href}
        className={className}
        aria-disabled={inert || undefined}
        onClick={(event) => {
          if (inert) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {children}
      </a>
    );
  }

  const {onClick, type, disabled, ...rest} = element;
  return (
    <button
      {...rest}
      // Buttons never submit a form by accident; forms pass type="submit".
      type={type ?? 'button'}
      disabled={disabled}
      className={className}
      aria-disabled={inert && !disabled ? true : undefined}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}
