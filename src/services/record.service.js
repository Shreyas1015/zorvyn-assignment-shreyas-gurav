const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { NotFoundError, ForbiddenError } = require('../utils/apiError');

const list = async ({ page, limit, type, category, startDate, endDate, sortBy, order }) => {
  const skip = (page - 1) * limit;
  const where = {};
  if (type) where.type = type;
  if (category) where.category = category;
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [records, total] = await Promise.all([
    prisma.financialRecord.findMany({ where, skip, take: limit, orderBy: { [sortBy]: order } }),
    prisma.financialRecord.count({ where }),
  ]);

  return {
    records,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getById = async (id) => {
  const record = await prisma.financialRecord.findFirst({
    where: { id },
    include: { creator: { select: { id: true, name: true } } },
  });
  if (!record) throw new NotFoundError('Record not found');
  return record;
};

const create = async (data, userId) => {
  const record = await prisma.financialRecord.create({
    data: {
      amount: data.amount,
      type: data.type,
      category: data.category,
      date: new Date(data.date),
      description: data.description || null,
      createdBy: userId,
    },
  });
  logger.info('Record created', { recordId: record.id, type: record.type, userId });
  return record;
};

const update = async (id, data, userId, userRole) => {
  const existing = await prisma.financialRecord.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Record not found');

  // Ownership check — only the creator or an admin can modify
  if (userRole !== 'ADMIN' && existing.createdBy !== userId) {
    throw new ForbiddenError('You can only modify your own records');
  }

  const updateData = { ...data };
  if (data.date) updateData.date = new Date(data.date);

  const updated = await prisma.financialRecord.update({ where: { id }, data: updateData });
  logger.info('Record updated', { recordId: id, changes: Object.keys(data) });
  return updated;
};

const remove = async (id, userId, userRole) => {
  const existing = await prisma.financialRecord.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Record not found');

  if (userRole !== 'ADMIN' && existing.createdBy !== userId) {
    throw new ForbiddenError('You can only delete your own records');
  }

  await prisma.financialRecord.update({ where: { id }, data: { deletedAt: new Date() } });
  logger.info('Record soft-deleted', { recordId: id });
};

module.exports = { list, getById, create, update, remove };
