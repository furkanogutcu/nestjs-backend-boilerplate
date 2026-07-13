import './doc-gen-env';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../../app.module';
import { versioningConfig } from '../../../config/app.config';
import { buildOpenApiDocument } from '../openapi.factory';

const OUTPUT_PATH = join(process.cwd(), 'openapi.json');

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });

  app.enableVersioning(versioningConfig);

  try {
    const document = buildOpenApiDocument(app);

    writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`);

    console.log(`✅ OpenAPI spec written to ${OUTPUT_PATH} (version ${document.info.version})`);
  } finally {
    await app.close();
  }
}

void generate().catch((error) => {
  console.error('❌ Failed to generate OpenAPI spec', error);
  process.exit(1);
});
