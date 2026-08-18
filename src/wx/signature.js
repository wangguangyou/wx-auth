import crypto from 'node:crypto';

/**
 * 微信 JS-SDK 签名算法：字段名全小写、按字典序拼接后做 sha1。
 * url 必须是调用 wx.config 页面的完整地址（不含 # 及其后面部分）。
 */
export function createJsapiSignature({ ticket, url }) {
  const nonceStr = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const signature = crypto.createHash('sha1').update(raw, 'utf8').digest('hex');

  return { nonceStr, timestamp, signature };
}
