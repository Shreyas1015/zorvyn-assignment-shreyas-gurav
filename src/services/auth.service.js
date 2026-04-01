const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const config = require('../config');
const securityLogger = require('../lib/securityLogger');
const { USER_PUBLIC } = require('../constants/selects');
const { UnauthorizedError, ConflictError, ForbiddenError } = require('../utils/apiError');

// ─── TOKEN HELPERS ──────────────────────────────────

const generateAccessToken = (user) => {
  return jwt.sign({ userId: user.id, role: user.role, type: 'access' }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
};

const generateRefreshToken = async (userId, familyId = null) => {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const family = familyId || uuidv4();

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId,
      familyId: family,
      expiresAt: new Date(Date.now() + config.jwt.refreshMaxAgeMs),
    },
  });

  return { rawToken, familyId: family };
};

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ─── ACCOUNT LOCKOUT ────────────────────────────────

const checkLockout = (user) => {
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    throw new UnauthorizedError(`Account locked. Try again in ${minutesLeft} minutes`);
  }
};

const handleFailedAttempt = async (user, ip) => {
  const attempts = user.failedLoginAttempts + 1;
  const updateData = { failedLoginAttempts: attempts };

  if (attempts >= config.auth.maxFailedAttempts) {
    updateData.lockedUntil = new Date(Date.now() + config.auth.lockoutDurationMs);
    securityLogger.logAccountLocked(user.id, ip);
  }

  await prisma.user.update({ where: { id: user.id }, data: updateData });
};

const resetFailedAttempts = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
};

// ─── PUBLIC METHODS ─────────────────────────────────

const register = async ({ email, password, name }) => {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
    select: USER_PUBLIC,
  });

  const accessToken = generateAccessToken(user);
  const { rawToken } = await generateRefreshToken(user.id);

  return { user, accessToken, refreshToken: rawToken };
};

const login = async ({ email, password }, ip, userAgent) => {
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    securityLogger.logAuthFailure(email, ip, userAgent, 'user_not_found');
    throw new UnauthorizedError('Invalid credentials');
  }

  checkLockout(user);

  // Same generic message for inactive accounts — prevents account enumeration
  if (user.status === 'INACTIVE') {
    securityLogger.logAuthFailure(email, ip, userAgent, 'account_inactive');
    throw new UnauthorizedError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await handleFailedAttempt(user, ip);
    securityLogger.logAuthFailure(email, ip, userAgent, 'invalid_password');
    throw new UnauthorizedError('Invalid credentials');
  }

  // Success — reset lockout counter
  await resetFailedAttempts(user.id);

  // eslint-disable-next-line no-unused-vars
  const { passwordHash, deletedAt, failedLoginAttempts, lockedUntil, ...userData } = user;
  const accessToken = generateAccessToken(user);
  const { rawToken } = await generateRefreshToken(user.id);

  securityLogger.logAuthSuccess(user.id, ip, userAgent);
  return { user: userData, accessToken, refreshToken: rawToken };
};

const refresh = async (rawRefreshToken) => {
  if (!rawRefreshToken) throw new UnauthorizedError('No refresh token provided');

  const tokenHash = hashToken(rawRefreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: { user: { select: USER_PUBLIC } },
  });

  if (!storedToken) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Token was already revoked — possible compromise. Revoke entire family.
  if (storedToken.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: storedToken.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    securityLogger.logTokenFamilyRevoked(storedToken.userId, storedToken.familyId);
    throw new UnauthorizedError('Token reuse detected — all sessions revoked');
  }

  // Token expired
  if (new Date(storedToken.expiresAt) < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Check account is still active (admin may have deactivated since last login)
  const currentUser = await prisma.user.findFirst({ where: { id: storedToken.userId } });
  if (!currentUser || currentUser.status === 'INACTIVE') {
    throw new ForbiddenError('Account is inactive');
  }

  // Rotate: revoke old, issue new with same family
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = generateAccessToken(storedToken.user);
  const { rawToken } = await generateRefreshToken(storedToken.userId, storedToken.familyId);

  return { user: storedToken.user, accessToken, refreshToken: rawToken };
};

const logout = async (rawRefreshToken) => {
  if (!rawRefreshToken) return;

  const tokenHash = hashToken(rawRefreshToken);
  const storedToken = await prisma.refreshToken.findFirst({ where: { tokenHash } });

  if (storedToken && !storedToken.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });
    securityLogger.logTokenRevoked(storedToken.userId, 'logout');
  }
};

const logoutAll = async (userId) => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  securityLogger.logTokenRevoked(userId, 'logout_all');
};

module.exports = { register, login, refresh, logout, logoutAll };
