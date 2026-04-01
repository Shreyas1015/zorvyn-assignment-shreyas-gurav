const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique request ID to every request for tracing through logs.
 * Sets X-Request-Id header on the response for client-side correlation.
 */
const requestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
};

module.exports = requestId;
