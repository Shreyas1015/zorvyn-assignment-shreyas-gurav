const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const config = require('../config');
const { USER_PUBLIC } = require('../constants/selects');
const { NotFoundError, ConflictError } = require('../utils/apiError');

const list = async (page, limit) => {
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({ select: USER_PUBLIC, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.user.count(),
  ]);

  return {
    users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getById = async (id) => {
  const user = await prisma.user.findFirst({ where: { id }, select: USER_PUBLIC });
  if (!user) throw new NotFoundError('User not found');
  return user;
};

const create = async ({ email, password, name, role }) => {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: role || 'VIEWER' },
    select: USER_PUBLIC,
  });

  logger.info('User created by admin', { userId: user.id, email, role: user.role });
  return user;
};

const update = async (id, data) => {
  const existing = await prisma.user.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('User not found');

  const updated = await prisma.user.update({ where: { id }, data, select: USER_PUBLIC });
  logger.info('User updated', { userId: id, changes: Object.keys(data) });
  return updated;
};

const remove = async (id) => {
  const existing = await prisma.user.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('User not found');

  await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  logger.info('User soft-deleted', { userId: id });
};

module.exports = { list, getById, create, update, remove };
