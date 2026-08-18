export class AppError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 业务错误码
   * @param {string} message 可直接展示给调用方的描述
   * @param {Record<string, unknown>} [detail] 仅写日志，不返回给调用方
   */
  constructor(status, code, message, detail) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (code, message, detail) => new AppError(400, code, message, detail);
export const forbidden = (code, message, detail) => new AppError(403, code, message, detail);
export const upstream = (code, message, detail) => new AppError(502, code, message, detail);
