import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { AppInternalException } from '@shared/exceptions/internal.exception';

import { StorageVisibility } from '../enums/storage-visibility.enum';
import { StorageService } from './storage.service';

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
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'auto',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_BASE_URL: 'https://cdn.example.com',
  S3_FORCE_PATH_STYLE: true,
  UPLOAD_MAX_BYTES: 1024,
  UPLOAD_URL_TTL_SECONDS: 300,
}));

vi.mock('@config/env.config', () => ({ env: mockEnv }));

const IMAGES = ['image/png', 'image/jpeg'] as const;

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    mockEnv.S3_ENDPOINT = 'http://localhost:9000';
    mockEnv.S3_BUCKET = 'test-bucket';
    mockEnv.S3_ACCESS_KEY_ID = 'key';
    mockEnv.S3_SECRET_ACCESS_KEY = 'secret';
    mockEnv.S3_PUBLIC_BASE_URL = 'https://cdn.example.com';
    mockEnv.UPLOAD_MAX_BYTES = 1024;
    service = new StorageService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('configuration', () => {
    it('reports itself configured when the credentials are present', () => {
      expect(service.isConfigured).toBe(true);
    });

    it('reports itself unconfigured when the endpoint is absent', () => {
      mockEnv.S3_ENDPOINT = undefined;

      expect(new StorageService().isConfigured).toBe(false);
    });

    it('fails loudly rather than silently when an unconfigured service is used', async () => {
      mockEnv.S3_ENDPOINT = undefined;

      await expect(
        new StorageService().createUploadUrl({
          key: 'a.png',
          contentType: 'image/png',
          contentLength: 10,
          allowedContentTypes: IMAGES,
          visibility: StorageVisibility.Private,
        }),
      ).rejects.toBeInstanceOf(AppInternalException);
    });
  });

  describe('createUploadUrl', () => {
    const upload = {
      key: 'avatars/a.png',
      contentType: 'image/png',
      contentLength: 512,
      allowedContentTypes: IMAGES,
      visibility: StorageVisibility.Public,
    };

    it('signs a URL and pins the content type and length into the required headers', async () => {
      const result = await service.createUploadUrl(upload);

      expect(result.url).toContain('X-Amz-Signature');
      expect(result.key).toBe('public/avatars/a.png');
      expect(result.requiredHeaders).toEqual({ 'Content-Type': 'image/png', 'Content-Length': '512' });
      expect(result.expiresInSeconds).toBe(300);
    });

    it('rejects a content type outside the caller allowlist', async () => {
      await expect(service.createUploadUrl({ ...upload, contentType: 'application/pdf' })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });

    it('rejects a body larger than the global ceiling', async () => {
      await expect(service.createUploadUrl({ ...upload, contentLength: 2048 })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });

    it('rejects an empty body', async () => {
      await expect(service.createUploadUrl({ ...upload, contentLength: 0 })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });

    it('honours a caller limit that is stricter than the global one', async () => {
      await expect(service.createUploadUrl({ ...upload, contentLength: 512, maxBytes: 100 })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });

    it('never lets a caller raise the limit above the global ceiling', async () => {
      await expect(
        service.createUploadUrl({ ...upload, contentLength: 2048, maxBytes: 1024 * 1024 }),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('places a private upload under the private prefix', async () => {
      const result = await service.createUploadUrl({ ...upload, visibility: StorageVisibility.Private });

      expect(result.key).toBe('private/avatars/a.png');
    });
  });

  describe('publicUrl', () => {
    it('builds a URL under the configured public origin', () => {
      expect(service.publicUrl({ key: 'public/avatars/a.png' })).toBe('https://cdn.example.com/public/avatars/a.png');
    });

    it('refuses to hand out a public URL for a private object', () => {
      expect(() => service.publicUrl({ key: 'private/a.png' })).toThrow(AppInternalException);
    });

    it('fails when no public origin is configured', () => {
      mockEnv.S3_PUBLIC_BASE_URL = undefined;

      expect(() => new StorageService().publicUrl({ key: 'public/a.png' })).toThrow(AppInternalException);
    });
  });

  describe('buildKey', () => {
    it('strips a leading slash so the prefix is never doubled', () => {
      expect(service.buildKey({ key: '/a.png', visibility: StorageVisibility.Public })).toBe('public/a.png');
    });
  });
});
