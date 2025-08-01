const Joi = require('joi');
const logger = require('../logger');

// Joi schema for webhook payload. It checks required fields but
// allows the body to include additional keys that we don't explicitly list.
const schema = Joi.object({
  payment_id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  data: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  }).optional(),
})
  .or('payment_id', 'id', 'data')
  // allow additional fields in the webhook payload
  .unknown(true);

module.exports = function validateWebhook(req, res, next) {
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    logger.warn(`invalid body: ${error.message}`);
    return res.status(400).json({ error: 'Invalid payload' });
  }
  req.body = value;
  next();
};
