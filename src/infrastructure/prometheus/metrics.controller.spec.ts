import { register, Registry } from 'prom-client';

import { createMockRequest, createMockResponse } from '@test/helpers';

import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  afterEach(() => {
    register.setContentType(Registry.PROMETHEUS_CONTENT_TYPE);
    jest.restoreAllMocks();
  });

  it('writes the prometheus content type and serialized metrics by default', async () => {
    jest.spyOn(register, 'metrics').mockResolvedValue('# HELP up 1');
    const controller = new MetricsController();
    const request = createMockRequest({ headers: {} });
    const response = createMockResponse();

    await controller.getMetrics(request, response);

    expect(response.set).toHaveBeenCalledWith('Content-Type', register.contentType);
    expect(register.contentType).toBe(Registry.PROMETHEUS_CONTENT_TYPE);
    expect(response.send).toHaveBeenCalledWith('# HELP up 1');
  });

  it('emits OpenMetrics so exemplars render when the client accepts it', async () => {
    jest.spyOn(register, 'metrics').mockResolvedValue('# EOF');
    const controller = new MetricsController();
    const request = createMockRequest({ headers: { accept: 'application/openmetrics-text' } });
    const response = createMockResponse();

    await controller.getMetrics(request, response);

    expect(register.contentType).toBe(Registry.OPENMETRICS_CONTENT_TYPE);
  });
});
