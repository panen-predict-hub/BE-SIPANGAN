import Joi from 'joi';
import InvariantError from '../../utils/exceptions/InvariantError.js';

const PredictQuerySchema = Joi.object({
  commodity: Joi.string().trim().max(100).required(),
  region: Joi.string().trim().max(100).required(),
  force: Joi.string().valid('true', 'false').default('false'),
}).unknown(false);

const PredictValidator = {
  validatePredictQuery: (payload) => {
    const { error, value } = PredictQuerySchema.validate(payload, { abortEarly: false });
    if (error) {
      throw new InvariantError(error.details.map((d) => d.message).join('; '));
    }
    return value;
  },
};

export default PredictValidator;
