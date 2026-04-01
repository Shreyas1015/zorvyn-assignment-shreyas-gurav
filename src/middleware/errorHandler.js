const { Prisma } = require('@prisma/client');
const { AppError } = require('../utils/apiError');
const { buildMeta } = require('../utils/apiResponse');
const logger = require('../lib/logger');

/**
 * Global error handler.
 * Maps AppError hierarchy, Prisma errors, and unexpected errors to consistent responses.
 * Never leaks stack traces or internal details to the client.
 */
const errorHandler = (err, req, res, next) => {
  const meta = buildMeta(req);

  // ─── Operational errors (AppError hierarchy) ──────
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, { requestId: req.id, stack: err.stack });
    }
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      meta,
    });
  }

  // ─── Prisma known errors ──────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaError(err, req, res, meta);
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma validation error', { requestId: req.id, message: err.message });
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_DATA', message: 'Invalid data provided', details: [] },
      meta,
    });
  }

  // ─── Malformed JSON ───────────────────────────────
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'MALFORMED_JSON', message: 'Malformed JSON in request body', details: [] },
      meta,
    });
  }

  // ─── Unexpected errors ────────────────────────────
  logger.error('Unhandled error', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
    meta,
  });
};

function handlePrismaError(err, req, res, meta) {
  switch (err.code) {
    case 'P2002': {
      const field = err.meta?.target?.join(', ') || 'field';
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: `A record with this ${field} already exists`,
          details: [],
        },
        meta,
      });
    }
    case 'P2025':
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found', details: [] },
        meta,
      });
    case 'P2003': {
      const field = err.meta?.field_name || 'reference';
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REFERENCE', message: `Invalid reference: ${field}`, details: [] },
        meta,
      });
    }
    default:
      logger.error('Unhandled Prisma error', {
        requestId: req.id,
        code: err.code,
        message: err.message,
      });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
        meta,
      });
  }
}

module.exports = errorHandler;
