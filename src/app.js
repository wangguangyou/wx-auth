import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler, requireAdminToken } from './middleware.js';
import { adminStatus, wxRouter } from './routes/wx.js';
import { isAllowedOrigin } from './wx/urlGuard.js';

function buildCors() {
  return cors({
    origin(origin, callback) {
      // 无 Origin：同源页面、服务端调用、健康检查，直接放行
      if (!origin) return callback(null, true);
      return callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-api-key'],
    maxAge: 600,
  });
}

export function createApp() {
  const app = express();

  // 只信任 Nginx 一层，避免客户端伪造 X-Forwarded-For 绕过限流
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(express.json({ limit: '8kb' }));

  // 健康检查不做限流、不依赖微信，便于 systemd / 探针高频调用
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.use(
    '/api',
    buildCors(),
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
    }),
  );
  app.use('/api/wx', wxRouter);

  app.get('/admin/status', requireAdminToken, adminStatus);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
