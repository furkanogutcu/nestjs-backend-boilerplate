import { metrics } from '@opentelemetry/api';

import { appConfig } from '@config/app.config';

import { getMeter } from './meter';

describe('getMeter', () => {
  it('resolves a meter named after the application slug', () => {
    const getMeterSpy = vi.spyOn(metrics, 'getMeter');

    getMeter();

    expect(getMeterSpy).toHaveBeenCalledWith(appConfig.slug);
  });

  it('returns a meter able to create instruments', () => {
    expect(getMeter().createHistogram('test.histogram')).toBeDefined();
  });
});
