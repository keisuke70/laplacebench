type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
}

const config: LoggerConfig = {
  enabled: process.env.NODE_ENV !== 'production',
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return config.enabled && LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) console.log('[DEBUG]', ...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog('info')) console.log('[INFO]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) console.warn('[WARN]', ...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog('error')) console.error('[ERROR]', ...args);
  },
};

// Export config for testing/debugging
export const setLoggerConfig = (newConfig: Partial<LoggerConfig>) => {
  Object.assign(config, newConfig);
};
