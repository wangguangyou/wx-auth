import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { fetchJsapiTicket, fetchStableAccessToken, INVALID_CREDENTIAL_CODES } from './wxApi.js';

/** 提前过期，避免临界点用到刚失效的凭证 */
const SAFETY_WINDOW_MS = 5 * 60 * 1000;

const cacheFilePath = path.resolve(process.cwd(), config.cacheFile);

/** @type {{accessToken: {value: string, expiresAt: number} | null, jsapiTicket: {value: string, expiresAt: number} | null}} */
const memory = { accessToken: null, jsapiTicket: null };

/** 同一凭证的并发刷新只发一次请求 */
const inflight = new Map();

let restored = false;

function isFresh(entry) {
  return Boolean(entry?.value) && entry.expiresAt - SAFETY_WINDOW_MS > Date.now();
}

/** 已进入安全窗口但尚未真正过期：刷新失败时可以降级继续用 */
function isUsable(entry) {
  return Boolean(entry?.value) && entry.expiresAt > Date.now();
}

function toEntry({ value, expiresInSeconds }) {
  return { value, expiresAt: Date.now() + expiresInSeconds * 1000 };
}

async function restoreFromDisk() {
  if (restored) return;
  restored = true;
  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    const saved = JSON.parse(raw);
    if (saved.appId !== config.wx.appId) {
      logger.warn('缓存文件属于其他 appId，忽略', { file: cacheFilePath });
      return;
    }
    if (isFresh(saved.accessToken)) memory.accessToken = saved.accessToken;
    if (isFresh(saved.jsapiTicket)) memory.jsapiTicket = saved.jsapiTicket;
    logger.info('已从本地缓存恢复微信凭证', {
      accessToken: Boolean(memory.accessToken),
      jsapiTicket: Boolean(memory.jsapiTicket),
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('读取凭证缓存失败，将重新向微信获取', { cause: String(error) });
    }
  }
}

async function persistToDisk() {
  try {
    await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
    const payload = JSON.stringify({ appId: config.wx.appId, ...memory }, null, 2);
    await fs.writeFile(cacheFilePath, payload, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    // 落盘只是重启后的优化，失败不影响本次请求
    logger.warn('写入凭证缓存失败', { cause: String(error) });
  }
}

function single(key, task) {
  const running = inflight.get(key);
  if (running) return running;

  const promise = task().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function getAccessToken({ forceRefresh = false } = {}) {
  await restoreFromDisk();
  if (!forceRefresh && isFresh(memory.accessToken)) {
    return memory.accessToken.value;
  }

  return single('accessToken', async () => {
    if (!forceRefresh && isFresh(memory.accessToken)) {
      return memory.accessToken.value;
    }
    const result = await fetchStableAccessToken({ forceRefresh });
    memory.accessToken = toEntry(result);
    await persistToDisk();
    logger.info('已刷新 access_token', { expiresIn: result.expiresInSeconds, forceRefresh });
    return memory.accessToken.value;
  });
}

export async function getJsapiTicket() {
  await restoreFromDisk();
  if (isFresh(memory.jsapiTicket)) {
    return memory.jsapiTicket.value;
  }

  return single('jsapiTicket', async () => {
    if (isFresh(memory.jsapiTicket)) {
      return memory.jsapiTicket.value;
    }

    let result;
    try {
      try {
        result = await fetchJsapiTicket(await getAccessToken());
      } catch (error) {
        if (!INVALID_CREDENTIAL_CODES.has(error.wxErrCode)) throw error;
        // token 被其他实例顶掉或提前失效：强制换一个再试一次
        logger.warn('access_token 已失效，强制刷新后重试', { errcode: error.wxErrCode });
        result = await fetchJsapiTicket(await getAccessToken({ forceRefresh: true }));
      }
    } catch (error) {
      // 微信侧临时故障时，只要手上的 ticket 还没真正过期就继续用，避免整站签名不可用
      if (isUsable(memory.jsapiTicket)) {
        logger.warn('刷新 jsapi_ticket 失败，降级使用未过期的旧凭证', {
          cause: error.message,
          expiresAt: new Date(memory.jsapiTicket.expiresAt).toISOString(),
        });
        return memory.jsapiTicket.value;
      }
      throw error;
    }

    memory.jsapiTicket = toEntry(result);
    await persistToDisk();
    logger.info('已刷新 jsapi_ticket', { expiresIn: result.expiresInSeconds });
    return memory.jsapiTicket.value;
  });
}

export function getCacheStatus() {
  return {
    accessToken: memory.accessToken ? { fresh: isFresh(memory.accessToken), expiresAt: new Date(memory.accessToken.expiresAt).toISOString() } : null,
    jsapiTicket: memory.jsapiTicket ? { fresh: isFresh(memory.jsapiTicket), expiresAt: new Date(memory.jsapiTicket.expiresAt).toISOString() } : null,
  };
}
