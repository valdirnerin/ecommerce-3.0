const Joi = require('joi');

// Joi schema for webhook payload. It accepts an empty body so that
// topic and id can also arrive via query parameters. Additional keys are
// allowed beyond the ones explicitly listed here.
const schema = Joi.object({
  payment_id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  topic: Joi.string().optional(),
  data: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  }).optional(),
}).unknown(true);

module.exports = function validateWebhook(body = {}) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) {
    const err = new Error(error.message);
    err.name = 'ValidationError';
    throw err;
  }
  return value;
};
