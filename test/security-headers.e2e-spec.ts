import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SecurityModule } from '@infrastructure/security/security.module';

@Controller('headers')
class HeadersController {
  @Get()
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Post()
  create(): { created: boolean } {
    return { created: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom');
  }
}

describe('Security headers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [HeadersController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function expectSecurityHeaders(headers: Record<string, string | string[] | undefined>): void {
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-dns-prefetch-control']).toBe('off');
    expect(headers['x-download-options']).toBe('noopen');
    expect(headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['origin-agent-cluster']).toBe('?1');
    expect(headers['x-xss-protection']).toBe('0');
    expect(headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    expect(headers['x-powered-by']).toBeUndefined();
  }

  it('sets the full helmet header set on a GET route', async () => {
    const response = await request(app.getHttpServer()).get('/headers').expect(200);

    expectSecurityHeaders(response.headers);
  });

  it('sets security headers on a POST route', async () => {
    const response = await request(app.getHttpServer()).post('/headers').expect(201);

    expectSecurityHeaders(response.headers);
  });

  it('sets security headers even when the handler throws (5xx)', async () => {
    const response = await request(app.getHttpServer()).get('/headers/boom').expect(500);

    expectSecurityHeaders(response.headers);
  });

  it('sets security headers on an unknown (404) route', async () => {
    const response = await request(app.getHttpServer()).get('/does-not-exist').expect(404);

    expectSecurityHeaders(response.headers);
  });
});
