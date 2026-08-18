import assert from 'node:assert/strict';
import test from 'node:test';

// config.js 在被导入时就会校验环境变量，必须先注入再动态导入
process.env.WX_APP_ID = 'wxtest';
process.env.WX_APP_SECRET = 'secret';
process.env.ALLOWED_HOSTS = 'm.example.com,*.demo.cn';
process.env.REQUIRE_HTTPS = 'true';

const { resolvePageUrl } = await import('../src/wx/urlGuard.js');

test('白名单内的 https 地址原样返回', () => {
  const url = 'https://m.example.com/a/b?x=1&y=%E4%B8%AD';
  assert.equal(resolvePageUrl(url), url);
});

test('截断 # 及其后面部分，其余字符不做任何归一化', () => {
  assert.equal(
    resolvePageUrl('https://m.example.com/Path?B=2&a=1#/route/x'),
    'https://m.example.com/Path?B=2&a=1',
  );
});

test('通配符同时匹配子域名与裸域名', () => {
  assert.equal(resolvePageUrl('https://wap.demo.cn/'), 'https://wap.demo.cn/');
  assert.equal(resolvePageUrl('https://demo.cn/'), 'https://demo.cn/');
});

test('域名不在白名单时返回 403', () => {
  assert.throws(() => resolvePageUrl('https://evil.com/'), { status: 403, code: 'HOST_NOT_ALLOWED' });
});

test('不能用后缀伪造域名', () => {
  assert.throws(() => resolvePageUrl('https://notdemo.cn/'), { code: 'HOST_NOT_ALLOWED' });
  assert.throws(() => resolvePageUrl('https://m.example.com.evil.com/'), { code: 'HOST_NOT_ALLOWED' });
});

test('REQUIRE_HTTPS 下拒绝 http', () => {
  assert.throws(() => resolvePageUrl('http://m.example.com/'), { code: 'URL_NOT_HTTPS' });
});

test('拒绝非 http(s) 协议与非法输入', () => {
  assert.throws(() => resolvePageUrl('javascript:alert(1)'), { code: 'URL_SCHEME_INVALID' });
  assert.throws(() => resolvePageUrl('/relative/path'), { code: 'URL_INVALID' });
  assert.throws(() => resolvePageUrl(''), { code: 'URL_REQUIRED' });
  assert.throws(() => resolvePageUrl(undefined), { code: 'URL_REQUIRED' });
});

test('拒绝超长 url', () => {
  assert.throws(() => resolvePageUrl(`https://m.example.com/?q=${'a'.repeat(2100)}`), {
    code: 'URL_TOO_LONG',
  });
});
