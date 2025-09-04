const Joi = require('joi');
const logger = require('../logger');

// Joi schema for webhook payload. It accepts an empty body so that
// topic/id can also arrive via query parameters. Additional keys are
// allowed beyond the ones explicitly listed here.
const schema = Joi.object({
  payment_id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  topic: Joi.string().optional(),
  data: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  }).optional(),
}).unknown(true);

module.exports = function validateWebhook(req, res, next) {
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    logger.warn(`invalid body: ${error.message}`);
    return res.status(400).json({ error: 'Invalid payload' });
  }
  req.body = value;
  next();
};
