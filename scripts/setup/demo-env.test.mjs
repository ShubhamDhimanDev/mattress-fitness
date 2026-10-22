import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {buildEnvFile, newSecret, parseOptions, run} from './demo-env.mjs';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const THIRD_PARTY = [
  'EXTEND',
  'KLAVIYO',
  'GA4',
  'META_PIXEL',
  'AFFIRM',
  'MAPS',
  'JUDGEME',
  'SHOPIFY_ADMIN',
  'SHOPIFY_APP',
];

let dir;
let printed;
const out = (text) => printed.push(text);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'demo-env-'));
  printed = [];
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('parseOptions', () => {
  it('needs exactly one of --mock or --store', () => {
    assert.throws(() => parseOptions([]), /exactly one/);
    assert.throws(
      () => parseOptions(['--mock', '--store', 'a.myshopify.com']),
      /exactly one/,
    );
  });

  it('accepts a shop domain and a 32 character token', () => {
    const o = parseOptions(['--store', 'My-Demo.myshopify.com', '--token', TOKEN]);
    assert.equal(o.domain, 'my-demo.myshopify.com');
    assert.equal(o.token, TOKEN);
  });

  it('refuses domains that are not a myshopify.com shop', () => {
    for (const bad of [
      'example.com',
      'a.myshopify.com.evil.test',
      'https://a.myshopify.com',
      'a b.myshopify.com',
      '-a.myshopify.com',
      'a.myshopify.com/path',
    ]) {
      assert.throws(
        () => parseOptions(['--store', bad, '--token', TOKEN]),
        /--store/,
        bad,
      );
    }
  });

  it('refuses a token that is not 32 letters and digits', () => {
    for (const bad of ['', 'short', `${TOKEN}0`, `${TOKEN.slice(1)}!`, 'a'.repeat(31)]) {
      assert.throws(
        () => parseOptions(['--store', 'a.myshopify.com', '--token', bad]),
        /--token/,
        bad,
      );
    }
    assert.throws(
      () => parseOptions(['--store', 'a.myshopify.com']),
      /--token/,
    );
  });

  it('refuses --out values that could reach another file', () => {
    for (const bad of ['.env', '../.env.demo', 'env.demo', '.env.', '/etc/x', '.env.a/b', 'sub/.env.demo']) {
      assert.throws(() => parseOptions(['--mock', '--out', bad]), /--out/, bad);
    }
    assert.equal(parseOptions(['--mock', '--out', '.env.mine']).out, '.env.mine');
  });

  it('uses the mock store without a token', () => {
    const o = parseOptions(['--mock']);
    assert.equal(o.domain, 'bedding.mock.shop');
    assert.equal(o.token.length, 32);
    assert.throws(() => parseOptions(['--mock', '--token', TOKEN]), /--token/);
  });
});

describe('buildEnvFile and run', () => {
  it('writes only the demo variables and nothing for any third-party service', () => {
    const text = buildEnvFile(
      {domain: 'a.myshopify.com', token: TOKEN, noOffers: false},
      {session: 'x'.repeat(64), delivery: 'y'.repeat(64)},
    );
    const names = text
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0]);
    assert.deepEqual(names, [
      'PUBLIC_STORE_DOMAIN',
      'PUBLIC_CHECKOUT_DOMAIN',
      'PUBLIC_STOREFRONT_API_TOKEN',
      'SESSION_SECRET',
      'DELIVERY_COOKIE_SECRET',
    ]);
    for (const word of THIRD_PARTY) {
      assert.ok(!names.some((n) => n.includes(word)), word);
    }
  });

  it('adds OFFERS_ENABLED=false only on request', () => {
    const base = {domain: 'a.myshopify.com', token: TOKEN};
    const s = {session: 'x'.repeat(64), delivery: 'y'.repeat(64)};
    assert.ok(!buildEnvFile({...base, noOffers: false}, s).includes('OFFERS_ENABLED'));
    assert.ok(buildEnvFile({...base, noOffers: true}, s).includes('OFFERS_ENABLED=false'));
  });

  it('generates two different 64 character secrets and never prints them', () => {
    const code = run(['--mock'], {storefrontDir: dir, out});
    assert.equal(code, 0);
    const text = readFileSync(join(dir, '.env.demo'), 'utf8');
    const session = /^SESSION_SECRET=(.+)$/m.exec(text)?.[1];
    const delivery = /^DELIVERY_COOKIE_SECRET=(.+)$/m.exec(text)?.[1];
    assert.match(session, /^[0-9a-f]{64}$/);
    assert.match(delivery, /^[0-9a-f]{64}$/);
    assert.notEqual(session, delivery);
    const shown = printed.join('\n');
    assert.ok(!shown.includes(session));
    assert.ok(!shown.includes(delivery));
    assert.ok(!shown.includes(TOKEN));
    assert.match(shown, /Third-party services: none/);
  });

  it('does not overwrite an existing file unless --force is given', () => {
    writeFileSync(join(dir, '.env.demo'), 'KEEP=me\n');
    assert.equal(run(['--mock'], {storefrontDir: dir, out}), 1);
    assert.equal(readFileSync(join(dir, '.env.demo'), 'utf8'), 'KEEP=me\n');
    assert.equal(run(['--mock', '--force'], {storefrontDir: dir, out}), 0);
    assert.ok(readFileSync(join(dir, '.env.demo'), 'utf8').includes('PUBLIC_STORE_DOMAIN'));
  });

  it('exits 2 and prints usage on a bad command line', () => {
    assert.equal(run(['--store', 'nope'], {storefrontDir: dir, out}), 2);
    assert.match(printed.join('\n'), /Usage:/);
  });

  it('restricts the file to its owner where the platform supports it', () => {
    run(['--mock'], {storefrontDir: dir, out});
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(dir, '.env.demo')).mode & 0o077, 0);
    }
  });

  it('newSecret uses the random source it is given', () => {
    assert.equal(newSecret(() => Buffer.alloc(32, 1)), '01'.repeat(32));
  });
});
