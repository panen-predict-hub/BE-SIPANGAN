import { describe, it, expect } from '@jest/globals';
import CommoditiesValidator from '../../src/validator/commodities/index.js';

describe('CommoditiesValidator', () => {
  it('should not throw error when valid commodity payload is provided', () => {
    const payload = {
      name: 'Beras Super',
      unit: 'kg',
    };
    expect(() => CommoditiesValidator.validateCommodityPayload(payload)).not.toThrow();
  });

  it('should use default unit "kg" if not provided', () => {
    const payload = { name: 'Beras Super' };
    const value = CommoditiesValidator.validateCommodityPayload(payload);
    expect(value.unit).toBe('kg');
  });

  it('should throw error for unknown fields', () => {
    const payload = { name: 'Beras', unknown: 'field' };
    expect(() => CommoditiesValidator.validateCommodityPayload(payload)).toThrow();
  });

  describe('validateThresholdPayload', () => {
    it('should not throw error when valid threshold payload with het_nominal is provided', () => {
      const payload = {
        waspada_percentage: 10,
        kritis_percentage: 25,
        het_nominal: 14500,
      };
      expect(() => CommoditiesValidator.validateThresholdPayload(payload)).not.toThrow();
    });

    it('should allow null het_nominal', () => {
      const payload = {
        waspada_percentage: 10,
        kritis_percentage: 25,
        het_nominal: null,
      };
      expect(() => CommoditiesValidator.validateThresholdPayload(payload)).not.toThrow();
    });

    it('should throw error when percentages are out of bounds', () => {
      const payload = {
        waspada_percentage: -5,
        kritis_percentage: 105,
      };
      expect(() => CommoditiesValidator.validateThresholdPayload(payload)).toThrow();
    });
  });
});
