const { z } = require('zod');

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError || (err && Array.isArray(err.issues))) {
        const issues = err.issues || err.errors || [];
        const details = issues.map(e => ({
          field: Array.isArray(e.path) ? e.path.join('.') : '',
          message: e.message
        }));
        return res.status(400).json({
          error: details[0]?.message || 'Validation failed',
          details
        });
      }
      return res.status(400).json({ error: 'Invalid request payload' });
    }
  };
}

module.exports = {
  validateBody,
  z
};
