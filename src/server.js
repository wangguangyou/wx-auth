import http from 'node:http';

/** 配置错误时用这个退出码，配合 systemd 的 RestartPreventExitStatus 避免无意义的无限重启 */
const EXIT_CONFIG_ERROR = 78;

async function main() {
  let config;
  try {
    ({ config } = await import('./config.js'));
  } catch (error) {
    process.stderr.write(`[wx-auth] 配置错误，启动中止：${error.message}\n`);
    process.exit(EXIT_CONFIG_ERROR);
    return;
  }

  const { logger } = await import('./logger.js');
  const { createApp } = await import('./app.js');
  const { startCredentialRefresher } = await import('./wx/refresher.js');

  const server = http.createServer(createApp());
  // 慢连接不占着 worker，反代场景下 keepAlive 要比 Nginx 的 60s 略长
  server.headersTimeout = 20_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 65_000;

  const stopRefresher = startCredentialRefresher();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('收到退出信号，开始优雅停机', { signal });
    stopRefresher();
    server.close(() => {
      logger.info('已停机');
      process.exit(0);
    });
    // 兜底：连接迟迟不断开时强制退出，避免 systemd 停机超时
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 进程级兜底：记录后退出，交给 systemd 立即拉起，避免带着未知状态继续服务
  process.on('uncaughtException', (error) => {
    logger.error('未捕获异常，进程即将退出', { cause: error.message, stack: error.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝，进程即将退出', { cause: String(reason) });
    process.exit(1);
  });

  server.on('error', (error) => {
    logger.error('HTTP 服务启动失败', { cause: error.message });
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info('wx-auth 已启动', {
      host: config.host,
      port: config.port,
      env: config.env,
      appId: config.wx.appId,
      allowedHosts: config.allowedHosts,
      apiKeyRequired: config.apiKeys.length > 0,
    });
  });
}

void main();
