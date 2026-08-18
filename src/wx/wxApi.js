import { config } from '../config.js';
import { upstream } from '../errors.js';

/** 这些 errcode 说明凭证已失效，需要强制刷新后重试一次 */
export const INVALID_CREDENTIAL_CODES = new Set([40001, 40014, 42001, 42007, 40163]);

async function requestJson(url, init) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(config.wx.timeoutMs),
    });
  } catch (error) {
    throw upstream('WX_NETWORK_ERROR', '调用微信接口失败', { cause: String(error) });
  }

  if (!response.ok) {
    throw upstream('WX_HTTP_ERROR', '微信接口返回异常状态', { status: response.status });
  }

  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw upstream('WX_BAD_RESPONSE', '微信接口返回内容无法解析');
  }
  return body;
}

/**
 * 稳定版接口：多实例并发获取不会互相顶掉旧 token。
 * https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/getStableAccessToken.html
 */
export async function fetchStableAccessToken({ forceRefresh = false } = {}) {
  const body = await requestJson(`${config.wx.apiBase}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: config.wx.appId,
      secret: config.wx.appSecret,
      force_refresh: forceRefresh,
    }),
  });

  if (!body.access_token) {
    throw upstream('WX_TOKEN_ERROR', `获取 access_token 失败：${body.errmsg || '未知错误'}`, {
      errcode: body.errcode,
      errmsg: body.errmsg,
    });
  }

  return {
    value: body.access_token,
    expiresInSeconds: Number(body.expires_in) || 7200,
  };
}

export async function fetchJsapiTicket(accessToken) {
  const url = new URL(`${config.wx.apiBase}/cgi-bin/ticket/getticket`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'jsapi');

  const body = await requestJson(url, { method: 'GET' });

  if (body.errcode !== 0 || !body.ticket) {
    const error = upstream('WX_TICKET_ERROR', `获取 jsapi_ticket 失败：${body.errmsg || '未知错误'}`, {
      errcode: body.errcode,
      errmsg: body.errmsg,
    });
    error.wxErrCode = Number(body.errcode);
    throw error;
  }

  return {
    value: body.ticket,
    expiresInSeconds: Number(body.expires_in) || 7200,
  };
}
