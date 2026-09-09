import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

import { StorageVisibility } from '../enums/storage-visibility.enum';
import { StorageService } from './storage.service';

const BUCKET = 'test-bucket';
const IMAGES = ['image/png'] as const;

interface IMockEnv {
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_PUBLIC_BASE_URL?: string;
  S3_FORCE_PATH_STYLE: boolean;
  UPLOAD_MAX_BYTES: number;
  UPLOAD_URL_TTL_SECONDS: number;
}

// * vi.mock is hoisted above the imports, so the object it closes over has to be hoisted too.
const mockEnv: IMockEnv = vi.hoisted(() => ({
  S3_ENDPOINT: '',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  S3_PUBLIC_BASE_URL: 'https://cdn.example.com',
  S3_FORCE_PATH_STYLE: true,
  UPLOAD_MAX_BYTES: 1024,
  UPLOAD_URL_TTL_SECONDS: 300,
}));

vi.mock('@config/env.config', () => ({ env: mockEnv }));

describe('StorageService (integration)', () => {
  let container: StartedTestContainer;
  let service: StorageService;

  beforeAll(async () => {
    container = await new GenericContainer('minio/minio:latest')
      .withExposedPorts(9000)
      .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
      .withCommand(['server', '/data'])
      .start();

    mockEnv.S3_ENDPOINT = `http://${container.getHost()}:${container.getMappedPort(9000)}`;

    const admin = new S3Client({
      region: mockEnv.S3_REGION,
      endpoint: mockEnv.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    });
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    admin.destroy();

    service = new StorageService();
  }, 180000);

  afterAll(async () => {
    service?.onModuleDestroy();
    await container?.stop();
  });

  async function signUpload(body: string, contentType = 'image/png'): Promise<{ url: string; key: string }> {
    const signed = await service.createUploadUrl({
      key: `object-${Math.random().toString(36).slice(2)}.png`,
      contentType,
      contentLength: Buffer.byteLength(body),
      allowedContentTypes: IMAGES,
      visibility: StorageVisibility.Private,
    });

    return { url: signed.url, key: signed.key };
  }

  it('accepts an upload that matches the signed content type and length', async () => {
    const body = 'a-png-payload';
    const { url, key } = await signUpload(body);

    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png' },
    });

    expect(response.status).toBe(200);
    await expect(service.exists({ key })).resolves.toBe(true);
  });

  it('rejects a body larger than the length that was signed', async () => {
    const { url } = await signUpload('small');

    const response = await fetch(url, {
      method: 'PUT',
      body: 'a-much-longer-body-than-was-signed',
      headers: { 'Content-Type': 'image/png' },
    });

    expect(response.ok).toBe(false);
  });

  it('rejects an upload whose content type differs from the signed one', async () => {
    const body = 'a-png-payload';
    const { url } = await signUpload(body);

    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/pdf' },
    });

    expect(response.ok).toBe(false);
  });

  it('serves a stored object through a signed download URL', async () => {
    const body = 'downloadable';
    const { url, key } = await signUpload(body);
    await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png' },
    });

    const downloadUrl = await service.createDownloadUrl({ key });

    await expect((await fetch(downloadUrl)).text()).resolves.toBe(body);
  });

  it('removes an object and reports it gone', async () => {
    const body = 'to-be-deleted';
    const { url, key } = await signUpload(body);
    await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png' },
    });

    await service.delete({ key });

    await expect(service.exists({ key })).resolves.toBe(false);
  });

  it('reports a key that was never stored as absent', async () => {
    await expect(service.exists({ key: 'private/never-written.png' })).resolves.toBe(false);
  });
});
