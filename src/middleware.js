import crypto from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** API_KEYS 为空表示不启用密钥校验（此时仅靠域名白名单 + 限流保护） */
export function requireApiKey(req, res, next) {
  if (config.apiKeys.length === 0) return next();

  const provided = req.get('x-api-key') || '';
  if (!provided || !config.apiKeys.some((key) => timingSafeEqual(key, provided))) {
    return next(new AppError(401, 'API_KEY_INVALID', '缺少或错误的 X-API-Key'));
  }
  return next();
}

/** ADMIN_TOKEN 未配置时直接关闭管理接口，避免默认暴露内部状态 */
export function requireAdminToken(req, res, next) {
  if (!config.adminToken) {
    return next(new AppError(404, 'NOT_FOUND', '接口不存在'));
  }
  const provided = req.get('x-admin-token') || '';
  if (!provided || !timingSafeEqual(config.adminToken, provided)) {
    return next(new AppError(401, 'ADMIN_TOKEN_INVALID', '缺少或错误的 X-Admin-Token'));
  }
  return next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
}

/* eslint-disable-next-line no-unused-vars -- Express 依靠 4 个参数识别错误中间件 */
export function errorHandler(error, req, res, next) {
  const known = error instanceof AppError;
  const status = known ? error.status : 500;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const message = known ? error.message : '服务内部错误';

  const meta = {
    method: req.method,
    path: req.originalUrl,
    status,
    code,
    ...(known ? { detail: error.detail } : { stack: error.stack }),
  };
  if (status >= 500) logger.error(message, meta);
  else logger.warn(message, meta);

  if (res.headersSent) return;
  res.status(status).json({ ok: false, code, message });
}
