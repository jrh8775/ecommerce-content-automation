/**
 * Custom error classes and error handling utilities
 */

class APIError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends APIError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

class QuotaError extends APIError {
  constructor(message = 'API quota exceeded. Please check your plan and billing details.') {
    super(message, 429, 'QUOTA_EXCEEDED');
  }
}

class GoogleSheetsError extends APIError {
  constructor(message, statusCode = 500) {
    super(message, statusCode, 'GOOGLE_SHEETS_ERROR');
  }
}

class OpenAIError extends APIError {
  constructor(message, statusCode = 500) {
    super(message, statusCode, 'OPENAI_ERROR');
  }
}

/**
 * Format error response for API endpoints
 */
function formatErrorResponse(error) {
  if (error instanceof APIError) {
    return {
      error: error.message,
      code: error.code,
      field: error.field || undefined,
      timestamp: error.timestamp,
    };
  }

  // Handle OpenAI API errors
  if (error.status === 429) {
    return {
      error: 'API quota exceeded. Please check your plan and billing details.',
      code: 'QUOTA_EXCEEDED',
      timestamp: new Date().toISOString(),
    };
  }

  if (error.status === 401) {
    return {
      error: 'Invalid API credentials. Please check your authentication.',
      code: 'AUTH_ERROR',
      timestamp: new Date().toISOString(),
    };
  }

  if (error.status >= 500) {
    return {
      error: 'External API error. Please try again later.',
      code: 'EXTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    };
  }

  // Generic error
  return {
    error: error.message || 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate product data
 */
function validateProductData(data) {
  const errors = [];

  if (!data.name || data.name.trim() === '') {
    errors.push('Product name is required');
  }

  if (!data.category || data.category.trim() === '') {
    errors.push('Product category is required');
  }

  if (data.price !== undefined && (isNaN(data.price) || parseFloat(data.price) < 0)) {
    errors.push('Product price must be a valid positive number');
  }

  if (data.features && typeof data.features !== 'string') {
    errors.push('Product features must be a string');
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('; '));
  }
}

/**
 * Validate spreadsheet parameters
 */
function validateSpreadsheetParams(params) {
  if (!params.spreadsheetId || params.spreadsheetId.trim() === '') {
    throw new ValidationError('Spreadsheet ID is required', 'spreadsheetId');
  }

  if (!params.inputRange || params.inputRange.trim() === '') {
    throw new ValidationError('Input range is required', 'inputRange');
  }

  if (!params.outputRange || params.outputRange.trim() === '') {
    throw new ValidationError('Output range is required', 'outputRange');
  }
}

/**
 * Centralized error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', {
    message: err.message,
    code: err.code || 'UNKNOWN',
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.statusCode || 500;
  const errorResponse = formatErrorResponse(err);

  res.status(statusCode).json(errorResponse);
}

module.exports = {
  APIError,
  ValidationError,
  QuotaError,
  GoogleSheetsError,
  OpenAIError,
  formatErrorResponse,
  validateProductData,
  validateSpreadsheetParams,
  errorHandler,
};
