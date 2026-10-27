/**
 * Custom error classes following best practices
 * Provides structured error handling with context
 */

export enum ErrorCode {
  // Storage errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',

  // DOM errors
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  ELEMENT_QUERY_FAILED = 'ELEMENT_QUERY_FAILED',

  // Timeline errors
  TIMELINE_INIT_FAILED = 'TIMELINE_INIT_FAILED',
  TIMELINE_RENDER_FAILED = 'TIMELINE_RENDER_FAILED',

  // Folder errors
  FOLDER_CREATE_FAILED = 'FOLDER_CREATE_FAILED',
  FOLDER_UPDATE_FAILED = 'FOLDER_UPDATE_FAILED',
  FOLDER_DELETE_FAILED = 'FOLDER_DELETE_FAILED',

  // Conversation errors
  CONVERSATION_ADD_FAILED = 'CONVERSATION_ADD_FAILED',
  CONVERSATION_REMOVE_FAILED = 'CONVERSATION_REMOVE_FAILED',
  CONVERSATION_NAVIGATE_FAILED = 'CONVERSATION_NAVIGATE_FAILED',

  // Generic errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export interface ErrorContext {
  [key: string]: unknown;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: ErrorContext,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'AppError';

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
      originalError: this.originalError?.message,
    };
  }
}

export class StorageError extends AppError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext, originalError?: Error) {
    super(code, message, context, originalError);
    this.name = 'StorageError';
  }
}

export class DOMError extends AppError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext, originalError?: Error) {
    super(code, message, context, originalError);
    this.name = 'DOMError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(ErrorCode.VALIDATION_ERROR, message, context);
    this.name = 'ValidationError';
  }
}

/**
 * Error handler utility
 */
export class ErrorHandler {
  static handle(error: unknown, context?: ErrorContext): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError(ErrorCode.UNKNOWN_ERROR, error.message, context, error);
    }

    return new AppError(ErrorCode.UNKNOWN_ERROR, String(error), context);
  }

  static isRecoverable(error: AppError): boolean {
    const recoverableCodes = [ErrorCode.ELEMENT_NOT_FOUND, ErrorCode.STORAGE_READ_FAILED];

    return recoverableCodes.includes(error.code);
  }
}
