import { BigintTransformer } from './bigint.transformer';

describe('BigintTransformer', () => {
  const transformer = new BigintTransformer();

  describe('from', () => {
    it('parses a numeric string from the driver into a number', () => {
      expect(transformer.from('1000')).toBe(1000);
    });

    it('passes null through', () => {
      expect(transformer.from(null)).toBeNull();
    });
  });

  describe('to', () => {
    it('passes a number through for the driver to serialize', () => {
      expect(transformer.to(2500)).toBe(2500);
    });

    it('maps null through', () => {
      expect(transformer.to(null)).toBeNull();
    });
  });
});
