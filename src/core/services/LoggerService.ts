/**
 * Centralized logging service
 * Replaces scattered console.log statements
 */
import type { ILogger } from '../types/common';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LoggerConfig {
  level: LogLevel;
  prefix: string;
  enableTimestamp: boolean;
  enableContext: boolean;
}

export class LoggerService implements ILogger {
  private static instance: LoggerService;
  private config: LoggerConfig;

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level:
        config.level ?? (process.env.NODE_ENV === 'production' ? LogLevel.WARN : LogLevel.DEBUG),
      prefix: config.prefix ?? '[Voyager]',
      enableTimestamp: config.enableTimestamp ?? true,
      enableContext: config.enableContext ?? true,
    };
  }

  static getInstance(config?: Partial<LoggerConfig>): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService(config);
    }
    return LoggerService.instance;
  }

  /**
   * Create a child logger with a specific prefix
   */
  createChild(prefix: string): ILogger {
    return new LoggerService({
      ...this.config,
      prefix: `${this.config.prefix}:${prefix}`,
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.config.level) {
      return;
    }

    const timestamp = this.config.enableTimestamp ? new Date().toISOString() : '';

    const prefix = this.config.prefix;
    const levelStr = LogLevel[level];

    const parts = [timestamp, prefix, `[${levelStr}]`, message].filter(Boolean);

    const logMessage = parts.join(' ');

    const logFn = this.getLogFunction(level);

    if (this.config.enableContext && context) {
      logFn(logMessage, context);
    } else {
      logFn(logMessage);
    }
  }

  private getLogFunction(level: LogLevel): (...args: unknown[]) => void {
    /* oxlint-disable no-console -- the logger is the one sanctioned path to the console */
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug.bind(console);
      case LogLevel.INFO:
        return console.info.bind(console);
      case LogLevel.WARN:
        return console.warn.bind(console);
      case LogLevel.ERROR:
        return console.error.bind(console);
      default:
        return console.log.bind(console);
    }
    /* oxlint-enable no-console */
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  getLevel(): LogLevel {
    return this.config.level;
  }
}

// Export singleton instance
export const logger = LoggerService.getInstance();
