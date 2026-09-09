import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export function resolveDocsVersion(): string {
  return process.env.NEXT_VERSION ?? process.env.npm_package_version ?? '0.0.0';
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('App API')
    .setDescription('Backend API for the App mobile game.')
    .setVersion(resolveDocsVersion())
    .addBearerAuth()
    .addServer('http://localhost:4001', 'Local development')
    .addServer('/', 'Current host')
    .addTag('Auth', 'Guest onboarding, token refresh, sign-in and account linking')
    .addTag('Catalog', 'Versioned catalog sync: active version, locale-neutral bundle and per-locale strings')
    .addTag('Health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  return cleanupOpenApiDoc(document);
}
