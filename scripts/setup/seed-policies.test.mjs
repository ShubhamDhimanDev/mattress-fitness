import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {POLICY_DOCUMENTS, findPlaceholders, stripLeadingComment} from './policies-lib.mjs';

// DEC-152: the policy documents are published by script. The script must never publish an unanswered [CONFIRM: ...] without
// being told to, and must not publish the authoring note.

const read = (file) => readFileSync(new URL(`../../docs/content/policies/${file}`, import.meta.url), 'utf8');

describe('policy documents', () => {
  it('every listed file exists, and the footer pages use the handles the footer links to', () => {
    for (const document of POLICY_DOCUMENTS) assert.ok(read(document.file).length > 100, document.file);
    const handles = POLICY_DOCUMENTS.filter((d) => d.kind === 'page').map((d) => d.handle);
    assert.deepEqual(handles, ['website-accessibility', 'submission-policy']);
    const types = POLICY_DOCUMENTS.filter((d) => d.kind === 'policy').map((d) => d.policyType);
    assert.deepEqual(types, ['PRIVACY_POLICY', 'REFUND_POLICY']);
  });

  it('strips only the leading authoring comment', () => {
    assert.equal(stripLeadingComment('<!-- note\nmore -->\n<p>Hello</p>\n'), '<p>Hello</p>');
    assert.equal(stripLeadingComment('<p>a</p><!-- keep -->'), '<p>a</p><!-- keep -->');
    for (const document of POLICY_DOCUMENTS) {
      assert.ok(!stripLeadingComment(read(document.file)).startsWith('<!--'), document.file);
    }
  });

  it('finds every [CONFIRM: ...] marker, and the refund and privacy policies still have some', () => {
    assert.deepEqual(findPlaceholders('a [CONFIRM: one] b [CONFIRM: two, three] c'), ['[CONFIRM: one]', '[CONFIRM: two, three]']);
    assert.deepEqual(findPlaceholders('<p>nothing</p>'), []);
    assert.ok(findPlaceholders(read('refund-policy.html')).length >= 5);
    assert.ok(findPlaceholders(read('privacy-policy.html')).length >= 3);
  });

  it('carries no warranty section and no reference-site name or contact detail', () => {
    for (const document of POLICY_DOCUMENTS) {
      const text = stripLeadingComment(read(document.file));
      assert.doesNotMatch(text, /warranty coverage|file a warranty claim|extended warranty/i, document.file);
      assert.doesNotMatch(text, /mattress warehouse|mattresswarehouse|4949 New Design|301-682|877-619|866\) 637|21048|hotjar|adobe/i, document.file);
    }
  });
});
