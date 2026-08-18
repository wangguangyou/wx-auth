import 'dotenv/config';

function readRequired(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value;
}

function readList(name) {
  return readRawList(name).map((item) => item.toLowerCase());
}

/** 大小写敏感的列表（密钥类配置不能被转成小写） */
function readRawList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBool(name, fallback) {
  const value = (process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

export const config = {
  env: process.env.NODE_ENV || 'production',
  port: readNumber('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',
  /** Nginx 反代时用于正确解析客户端 IP，直接暴露公网时改成 false */
  trustProxy: process.env.TRUST_PROXY || 'loopback',

  wx: {
    appId: readRequired('WX_APP_ID'),
    appSecret: readRequired('WX_APP_SECRET'),
    apiBase: (process.env.WX_API_BASE || 'https://api.weixin.qq.com').replace(/\/+$/, ''),
    timeoutMs: readNumber('WX_TIMEOUT_MS', 8000),
  },

  /** 允许被签名的页面域名白名单，支持 *.example.com 形式 */
  allowedHosts: readList('ALLOWED_HOSTS'),
  /** 允许跨域调用本服务的来源，为空则不放行任何跨域请求 */
  allowedOrigins: readList('ALLOWED_ORIGINS'),
  /** 微信 JS-SDK 只在 https 页面生效，本地联调时可临时关掉 */
  requireHttps: readBool('REQUIRE_HTTPS', true),

  cacheFile: process.env.CACHE_FILE || '.cache/wx-credentials.json',

  /** 非空时，调用签名接口必须带 `X-API-Key`，用于本服务只给自家应用使用的场景 */
  apiKeys: readRawList('API_KEYS'),
  /** 非空时才开放 /admin/status，用 `X-Admin-Token` 校验 */
  adminToken: (process.env.ADMIN_TOKEN || '').trim(),

  /** 启动即预热并后台定时刷新凭证，让请求链路不依赖微信接口的实时可用性 */
  prewarm: readBool('PREWARM', true),
  refreshIntervalMs: readNumber('REFRESH_INTERVAL_MS', 30 * 60 * 1000),

  rateLimit: {
    windowMs: readNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    max: readNumber('RATE_LIMIT_MAX', 60),
  },
};

if (config.allowedHosts.length === 0) {
  throw new Error(
    'ALLOWED_HOSTS 不能为空：签名服务必须限定可签名的页面域名，否则任何人都能拿它给自己的站点签名',
  );
}
