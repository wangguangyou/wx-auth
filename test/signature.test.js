import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createJsapiSignature } from '../src/wx/signature.js';

test('签名按字典序拼接后做 sha1', () => {
  const ticket = 'ticket-abc';
  const url = 'https://m.example.com/page?a=1';
  const { nonceStr, timestamp, signature } = createJsapiSignature({ ticket, url });

  const expected = crypto
    .createHash('sha1')
    .update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`, 'utf8')
    .digest('hex');

  assert.equal(signature, expected);
  assert.match(signature, /^[0-9a-f]{40}$/);
});

test('每次签名都换 nonceStr', () => {
  const args = { ticket: 't', url: 'https://m.example.com/' };
  const a = createJsapiSignature(args);
  const b = createJsapiSignature(args);
  assert.notEqual(a.nonceStr, b.nonceStr);
});

test('timestamp 为秒级整数', () => {
  const { timestamp } = createJsapiSignature({ ticket: 't', url: 'https://m.example.com/' });
  assert.ok(Number.isInteger(timestamp));
  assert.ok(Math.abs(timestamp - Date.now() / 1000) < 5);
});
