import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/** 假微信服务端，避免测试打到真实接口 */
const stub = { tokenCalls: 0, ticketCalls: 0, ticket: 'stub-ticket-1' };

const wxServer = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/cgi-bin/stable_token')) {
    stub.tokenCalls += 1;
    res.end(JSON.stringify({ access_token: 'stub-token', expires_in: 7200 }));
    return;
  }
  if (req.url.startsWith('/cgi-bin/ticket/getticket')) {
    stub.ticketCalls += 1;
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok', ticket: stub.ticket, expires_in: 7200 }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});

await new Promise((resolve) => wxServer.listen(0, '127.0.0.1', resolve));
const wxBase = `http://127.0.0.1:${wxServer.address().port}`;

const cacheFile = path.join(os.tmpdir(), `wx-auth-test-${process.pid}.json`);

process.env.WX_APP_ID = 'wxtest';
process.env.WX_APP_SECRET = 'secret';
process.env.WX_API_BASE = wxBase;
process.env.ALLOWED_HOSTS = 'm.example.com';
process.env.API_KEYS = 'key-one,key-two';
process.env.ADMIN_TOKEN = 'admin-secret';
process.env.CACHE_FILE = cacheFile;
process.env.PREWARM = 'false';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => wxServer.close(resolve));
  await fs.rm(cacheFile, { force: true });
});

const signatureUrl = (url) => `${base}/api/wx/jsapi-signature?url=${encodeURIComponent(url)}`;

test('GET /healthz 不需要鉴权', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('签名接口返回 wx.config 所需字段且签名可校验', async () => {
  const url = 'https://m.example.com/page?a=1';
  const res = await fetch(signatureUrl(url), { headers: { 'x-api-key': 'key-one' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const { ok, data } = await res.json();
  assert.equal(ok, true);
  assert.equal(data.appId, 'wxtest');
  assert.equal(data.url, url);

  const expected = crypto
    .createHash('sha1')
    .update(
      `jsapi_ticket=${stub.ticket}&noncestr=${data.nonceStr}&timestamp=${data.timestamp}&url=${url}`,
      'utf8',
    )
    .digest('hex');
  assert.equal(data.signature, expected);
});

test('POST 同样可用，且凭证命中缓存不再打微信', async () => {
  const before = stub.ticketCalls;
  const res = await fetch(`${base}/api/wx/jsapi-signature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'key-two' },
    body: JSON.stringify({ url: 'https://m.example.com/other#/hash' }),
  });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.url, 'https://m.example.com/other');
  assert.equal(stub.ticketCalls, before);
});

test('缺少或错误的 API Key 返回 401', async () => {
  const noKey = await fetch(signatureUrl('https://m.example.com/'));
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).code, 'API_KEY_INVALID');

  const badKey = await fetch(signatureUrl('https://m.example.com/'), {
    headers: { 'x-api-key': 'wrong' },
  });
  assert.equal(badKey.status, 401);
});

test('白名单外的域名返回 403', async () => {
  const res = await fetch(signatureUrl('https://evil.com/'), { headers: { 'x-api-key': 'key-one' } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'HOST_NOT_ALLOWED');
});

test('缺少 url 返回 400', async () => {
  const res = await fetch(`${base}/api/wx/jsapi-signature`, { headers: { 'x-api-key': 'key-one' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'URL_REQUIRED');
});

test('未配 ALLOWED_ORIGINS 时，CORS 自动复用 ALLOWED_HOSTS', async () => {
  const allowed = await fetch(signatureUrl('https://m.example.com/'), {
    headers: { 'x-api-key': 'key-one', origin: 'https://m.example.com' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://m.example.com');

  const denied = await fetch(signatureUrl('https://m.example.com/'), {
    headers: { 'x-api-key': 'key-one', origin: 'https://evil.com' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('/admin/status 需要 X-Admin-Token', async () => {
  const denied = await fetch(`${base}/admin/status`);
  assert.equal(denied.status, 401);

  const res = await fetch(`${base}/admin/status`, { headers: { 'x-admin-token': 'admin-secret' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.cache.jsapiTicket.fresh, true);
  assert.equal(JSON.stringify(body).includes(stub.ticket), false, '状态接口不应泄露凭证');
});

test('未知路径返回 404 JSON', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NOT_FOUND');
});
