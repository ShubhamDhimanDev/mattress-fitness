/**
 * Joins class names, skipping falsy values. There is no tailwind-merge here, so a component never relies on
 * a caller's class overriding one of its own: variants are props and `className` only adds layout
 * (margin, width, grid placement).
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
