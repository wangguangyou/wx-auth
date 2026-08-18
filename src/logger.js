function write(level, message, meta) {
  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const target = level === 'error' ? process.stderr : process.stdout;
  target.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
