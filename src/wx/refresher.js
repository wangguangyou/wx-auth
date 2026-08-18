import { config } from '../config.js';
import { logger } from '../logger.js';
import { getJsapiTicket } from './credentialStore.js';

/**
 * 后台预热 + 定时刷新凭证。
 * 目的是让签名请求几乎永远命中内存缓存，微信接口短时故障不影响线上页面。
 * @returns {() => void} 停止定时器
 */
export function startCredentialRefresher() {
  if (!config.prewarm) {
    logger.info('已关闭凭证预热（PREWARM=false）');
    return () => {};
  }

  const tick = async () => {
    try {
      await getJsapiTicket();
    } catch (error) {
      // 拿不到就等下一轮，绝不让后台任务把进程带崩
      logger.error('后台刷新凭证失败，稍后重试', { cause: error.message });
    }
  };

  void tick();
  const timer = setInterval(tick, config.refreshIntervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
