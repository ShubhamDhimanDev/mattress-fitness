import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// S-L3 (T-04): the tree scan (scripts/validate-framework.mjs) and the history scan (.github/workflows/ci.yml) must
// carry the same token shapes. The shapes below are in the syntax both share; the sample tokens are built at run time
// so this file holds no token shape itself.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const validator = readFileSync(join(root, 'scripts/validate-framework.mjs'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

const SHAPES = [
  'sk_live_[A-Za-z0-9]{16,}',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'github_pat_[A-Za-z0-9_]{30,}',
  'eyJ[A-Za-z0-9_-]{10,}[.]eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}',
];

const SAMPLES = [
  `${'sk_'}live_${'a1B2c3D4e5F6g7H8i9'}`,
  `${'gh'}p_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'}`,
  `${'gh'}o_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'}`,
  `${'github_'}pat_${'11A1B2C3D4E5F6G7H8I9J0_k1L2m3N4o5P6q7R8'}`,
  `${'ey'}JhbGciOiJIUzI1NiJ9.${'ey'}JzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u`,
];

test('both scans list every new token shape, written the same way', () => {
  for (const shape of SHAPES) {
    assert.ok(workflow.includes(`'${shape}'`), `ci.yml misses ${shape}`);
    assert.ok(validator.includes(`/${shape}/`), `validator misses ${shape}`);
  }
});

test('the shapes match realistic tokens and not ordinary text', () => {
  const regexes = SHAPES.map((shape) => new RegExp(shape));
  for (const sample of SAMPLES) {
    assert.ok(regexes.some((re) => re.test(sample)), `no shape matches a sample of ${sample.length} characters`);
  }
  for (const benign of [
    'sk_live_ is a prefix',
    'ghost_writer_of_a_long_story_about_beds_and_more',
    'eyJhIjoxfQ==',
    'eyJjIjoicG9zaXRpb24iLCJ2Ijo0LCJpIjozMTY2fQ',
  ]) {
    assert.ok(!regexes.some((re) => re.test(benign)), `matched ordinary text: ${benign}`);
  }
});

test('only the validator and the redaction test are excluded from the history scan', () => {
  const pathspecs = [...workflow.matchAll(/':!([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(pathspecs.sort(), [
    'scripts/validate-framework.mjs',
    'storefront/app/lib/logging/redact.test.ts',
  ]);
});
