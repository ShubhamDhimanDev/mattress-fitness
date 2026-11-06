// The policy documents of docs/content/policies/ and the two checks the publishing script needs. Kept apart from the script
// so they can be tested without a store.

/**
 * `policy`: Settings > Policies (Shopify's own policy type). `page`: an Online Store page that the footer links to.
 * @type {readonly ({kind: 'policy', file: string, policyType: string} | {kind: 'page', file: string, handle: string, title: string})[]}
 */
export const POLICY_DOCUMENTS = [
  {kind: 'policy', file: 'privacy-policy.html', policyType: 'PRIVACY_POLICY'},
  {kind: 'policy', file: 'refund-policy.html', policyType: 'REFUND_POLICY'},
  {kind: 'page', file: 'website-accessibility.html', handle: 'website-accessibility', title: 'Website Accessibility'},
  {kind: 'page', file: 'submission-terms.html', handle: 'submission-policy', title: 'Submission Terms'},
];

/** The authoring note at the top of each file is for people pasting by hand; it does not belong in the published text. */
export function stripLeadingComment(html) {
  return html.replace(/^\s*<!--[\s\S]*?-->\s*/, '').trim();
}

/** Every `[CONFIRM: ...]` marker: a fact the client still has to answer. */
export function findPlaceholders(html) {
  return html.match(/\[CONFIRM:[^\]]*\]/g) ?? [];
}
