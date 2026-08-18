import { Router } from 'express';
import { asyncHandler } from '../asyncHandler.js';
import { config } from '../config.js';
import { requireApiKey } from '../middleware.js';
import { getCacheStatus, getJsapiTicket } from '../wx/credentialStore.js';
import { createJsapiSignature } from '../wx/signature.js';
import { resolvePageUrl } from '../wx/urlGuard.js';

export const wxRouter = Router();

/**
 * 下发 wx.config 所需的 4 个字段。
 * GET  /api/wx/jsapi-signature?url=https%3A%2F%2Fm.example.com%2Fpage
 * POST /api/wx/jsapi-signature  { "url": "https://m.example.com/page" }
 */
const handleSignature = asyncHandler(async (req, res) => {
  const input = req.method === 'GET' ? req.query.url : req.body?.url;
  const url = resolvePageUrl(input);
  const ticket = await getJsapiTicket();
  const { nonceStr, timestamp, signature } = createJsapiSignature({ ticket, url });

  // 签名与 url 绑定，且随 timestamp 变化，禁止任何中间层缓存
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    data: { appId: config.wx.appId, timestamp, nonceStr, signature, url },
  });
});

wxRouter.get('/jsapi-signature', requireApiKey, handleSignature);
wxRouter.post('/jsapi-signature', requireApiKey, handleSignature);

/** 仅供排查：查看凭证缓存状态，不返回凭证本身 */
export const adminStatus = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data: { appId: config.wx.appId, cache: getCacheStatus() } });
};
