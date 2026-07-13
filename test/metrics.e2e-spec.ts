import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { versioningConfig } from '@config/app.config';
import { PrometheusModule } from '@infrastructure/prometheus/prometheus.module';

const METRICS_PATH = '/api/v1/metrics';

function basicAuthHeader({ user, password }: { user: string; password: string }): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('Metrics endpoint auth (e2e)', () => {
  let app: INestApplication;
  const user = process.env.METRICS_AUTH_USER as string;
  const password = process.env.METRICS_AUTH_PASSWORD as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrometheusModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.enableVersioning(versioningConfig);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer()).get(METRICS_PATH).expect(401);
  });

  it('rejects wrong credentials with 401', async () => {
    await request(app.getHttpServer())
      .get(METRICS_PATH)
      .set('Authorization', basicAuthHeader({ user, password: 'wrong-password-0123456789' }))
      .expect(401);
  });

  it('serves metrics to a request with valid credentials', async () => {
    const response = await request(app.getHttpServer())
      .get(METRICS_PATH)
      .set('Authorization', basicAuthHeader({ user, password }))
      .expect(200);

    expect(response.text).toContain('# HELP');
  });
});
