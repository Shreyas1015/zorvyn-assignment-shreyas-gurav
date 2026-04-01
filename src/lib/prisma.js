const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');
const config = require('../config');

const basePrisma = new PrismaClient({
  log: config.isProduction
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
});

basePrisma.$on('query', (e) => {
  const level = e.duration > 500 ? 'warn' : 'debug';
  logger[level](`DB query ${e.duration}ms`, { duration: `${e.duration}ms` });
});

basePrisma.$on('error', (e) => {
  logger.error('Prisma error', { message: e.message });
});

/**
 * Soft-delete middleware via $extends.
 * Auto-injects `deletedAt: null` on ALL read operations for soft-deletable models.
 * Models without deletedAt (RefreshToken, SecurityEvent) are unaffected.
 */
const SOFT_DELETE_OPERATIONS = ['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'];

const extensionConfig = { query: { $allModels: {} } };

for (const op of SOFT_DELETE_OPERATIONS) {
  extensionConfig.query.$allModels[op] = async function ({ model, args, query }) {
    // Only apply to models that have deletedAt (User, FinancialRecord)
    const softDeleteModels = ['User', 'FinancialRecord'];
    if (softDeleteModels.includes(model)) {
      args.where = addSoftDeleteFilter(args.where);
    }
    return query(args);
  };
}

const prisma = basePrisma.$extends(extensionConfig);

function addSoftDeleteFilter(where = {}) {
  if (where.deletedAt === undefined) {
    where.deletedAt = null;
  }
  return where;
}

module.exports = prisma;
