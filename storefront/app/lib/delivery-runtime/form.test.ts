import {describe, expect, it} from 'vitest';
import {readSmallForm} from '~/lib/delivery-runtime/form';

// T-01 / T-13: a small form is read with a hard size cap; anything odd is refused with a status, not thrown.

const URL_ = 'http://localhost:3000/delivery';

function urlencoded(body: string, headers: HeadersInit = {}) {
  return new Request(URL_, {
    method: 'POST',
    body,
    headers: {'Content-Type': 'application/x-www-form-urlencoded', ...headers},
  });
}

describe('readSmallForm', () => {
  it('reads url-encoded and multipart forms', async () => {
    const a = await readSmallForm(urlencoded('intent=save&zip=60645'));
    expect(a.status === 'ok' && a.form.get('zip')).toBe('60645');
    const body = new FormData();
    body.set('intent', 'clear');
    const b = await readSmallForm(new Request(URL_, {method: 'POST', body}));
    expect(b.status === 'ok' && b.form.get('intent')).toBe('clear');
  });

  it('refuses a declared length over the cap without reading the body', async () => {
    const request = urlencoded('a=b', {'Content-Length': '999999'});
    expect(await readSmallForm(request)).toEqual({status: 'too-large'});
  });

  it('cuts off a body that streams past the cap, whatever it declares', async () => {
    const big = `zip=${'1'.repeat(10_000)}`;
    expect(await readSmallForm(urlencoded(big))).toEqual({status: 'too-large'});
    const lying = urlencoded(big, {'Content-Length': '5'});
    expect(await readSmallForm(lying)).toEqual({status: 'too-large'});
  });

  it('accepts a body exactly at the cap and refuses one byte over', async () => {
    const at = `z=${'a'.repeat(98)}`;
    expect((await readSmallForm(urlencoded(at), 100)).status).toBe('ok');
    expect((await readSmallForm(urlencoded(`${at}b`), 100)).status).toBe(
      'too-large',
    );
  });

  it.each([
    ['json', 'application/json'],
    ['plain text', 'text/plain'],
    ['no type', ''],
  ])('refuses a %s body as unreadable', async (_n, type) => {
    const request = new Request(URL_, {
      method: 'POST',
      body: '{"a":1}',
      headers: type ? {'Content-Type': type} : {},
    });
    expect(await readSmallForm(request)).toEqual({status: 'unreadable'});
  });

  it('refuses a broken multipart body and a missing body', async () => {
    const broken = new Request(URL_, {
      method: 'POST',
      body: 'not multipart at all',
      headers: {'Content-Type': 'multipart/form-data; boundary=xyz'},
    });
    expect(await readSmallForm(broken)).toEqual({status: 'unreadable'});
    expect(await readSmallForm(new Request(URL_))).toEqual({
      status: 'unreadable',
    });
  });
});
