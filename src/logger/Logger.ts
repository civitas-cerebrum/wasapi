import Debug from "debug";

const PREFIX = 'wasapi';

const logsDisabled = process.env.WASAPI_DEBUG === 'false';

if (!logsDisabled && !process.env.DEBUG) {
  Debug.enable(`${PREFIX}:*`);
}

const NAMESPACE_PAD = 9;

export function createLogger(namespace: string): Debug.Debugger {
  const padded = namespace.padEnd(NAMESPACE_PAD);
  return Debug(`${PREFIX}:${padded}`);
}

export const logger = (type: string): Debug.Debugger => {
  const log = createLogger(`${type}`);
  log.color = {
    info:      '75',
    warn:      '214',
    error:     '203',
    success:   '78',
    important: '177',
  }[type] || log.color;
  return log;
};

export const log = {
  info: logger('info'),
  warn: logger('warn'),
  error: logger('error'),
  success: logger('success'),
  important: logger('important'),
};
