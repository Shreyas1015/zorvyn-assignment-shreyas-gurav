/**
 * Shared Prisma select objects.
 * Centralizes which fields are returned in API responses.
 * Ensures passwordHash is NEVER included in any response.
 */

const USER_PUBLIC = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  createdAt: true,
};

module.exports = { USER_PUBLIC };
