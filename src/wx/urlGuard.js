import { config } from '../config.js';
import { badRequest, forbidden } from '../errors.js';

const MAX_URL_LENGTH = 2048;

/**
 * 支持精确域名与 `*.example.com` 形式（后者同时匹配 example.com 本身）。
 * @param {string} host 已小写的 hostname
 * @param {string} rule 白名单条目
 */
function hostMatches(host, rule) {
  if (rule.startsWith('*.')) {
    const bare = rule.slice(2);
    return host === bare || host.endsWith(`.${bare}`);
  }
  return host === rule;
}

/**
 * 校验待签名页面地址，并返回真正参与签名的字符串。
 *
 * 注意：微信要求签名用的 url 必须与页面 location.href（去掉 # 及其后面部分）
 * 完全一致，所以这里只做「截断 hash」，绝不重新序列化 URL——否则大小写、
 * 端口、尾斜杠、转义方式的任何变化都会导致 invalid signature。
 *
 * @param {unknown} input 调用方传入的 url
 * @returns {string} 参与签名的 url
 */
export function resolvePageUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw badRequest('URL_REQUIRED', '缺少 url 参数，请传入 location.href.split("#")[0]');
  }

  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw badRequest('URL_TOO_LONG', `url 长度不能超过 ${MAX_URL_LENGTH} 个字符`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest('URL_INVALID', 'url 不是合法的绝对地址');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw badRequest('URL_SCHEME_INVALID', 'url 协议必须是 http 或 https');
  }
  if (config.requireHttps && parsed.protocol !== 'https:') {
    throw badRequest('URL_NOT_HTTPS', '微信 JS-SDK 只在 https 页面生效，url 必须是 https');
  }

  const host = parsed.hostname.toLowerCase();
  if (!config.allowedHosts.some((rule) => hostMatches(host, rule))) {
    throw forbidden('HOST_NOT_ALLOWED', `域名 ${host} 不在允许签名的白名单内`, { host });
  }

  const hashIndex = raw.indexOf('#');
  return hashIndex === -1 ? raw : raw.slice(0, hashIndex);
}

/**
 * 判断跨域来源是否放行。
 * 默认复用 ALLOWED_HOSTS：能被签名的页面，就是允许调用本服务的页面，
 * 不用把同一批域名再抄一遍到 ALLOWED_ORIGINS；确实需要不一致时再显式配置。
 * @param {string} origin 请求头里的 Origin
 */
export function isAllowedOrigin(origin) {
  if (config.allowedOrigins.length > 0) {
    return config.allowedOrigins.includes(origin.toLowerCase());
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (config.requireHttps && parsed.protocol !== 'https:') return false;

  return config.allowedHosts.some((rule) => hostMatches(parsed.hostname.toLowerCase(), rule));
}
