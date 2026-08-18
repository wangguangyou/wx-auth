/**
 * Express 4 不会自动接管 async 处理器抛出的异常，统一包一层转交错误中间件。
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<unknown>} handler
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
