import { describe, it, expect } from '@jest/globals';
import PredictValidator from '../../src/validator/predict/index.js';

describe('PredictValidator', () => {
  it('should not throw error when given valid predict payload without force', () => {
    const payload = {
      commodity: 'Beras Medium',
      region: 'Jawa Tengah',
    };

    expect(() => PredictValidator.validatePredictQuery(payload)).not.toThrow();
    const result = PredictValidator.validatePredictQuery(payload);
    expect(result.force).toBe('false'); // defaults to 'false'
  });

  it('should not throw error when force is true', () => {
    const payload = {
      commodity: 'Beras Medium',
      region: 'Jawa Tengah',
      force: 'true',
    };

    expect(() => PredictValidator.validatePredictQuery(payload)).not.toThrow();
    const result = PredictValidator.validatePredictQuery(payload);
    expect(result.force).toBe('true');
  });

  it('should not throw error when force is false', () => {
    const payload = {
      commodity: 'Beras Medium',
      region: 'Jawa Tengah',
      force: 'false',
    };

    expect(() => PredictValidator.validatePredictQuery(payload)).not.toThrow();
    const result = PredictValidator.validatePredictQuery(payload);
    expect(result.force).toBe('false');
  });

  it('should throw error when force is invalid', () => {
    const payload = {
      commodity: 'Beras Medium',
      region: 'Jawa Tengah',
      force: 'yes',
    };

    expect(() => PredictValidator.validatePredictQuery(payload)).toThrow();
  });

  it('should throw error when extra fields are present', () => {
    const payload = {
      commodity: 'Beras Medium',
      region: 'Jawa Tengah',
      extra: 'not allowed',
    };

    expect(() => PredictValidator.validatePredictQuery(payload)).toThrow();
  });
});
