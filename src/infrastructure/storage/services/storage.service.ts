import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { env } from '@config/env.config';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppInternalException } from '@shared/exceptions/internal.exception';

import { StorageVisibility } from '../enums/storage-visibility.enum';
import { STORAGE_PREFIXES } from '../storage.constant';

export interface ISignedUpload {
  url: string;
  key: string;
  expiresInSeconds: number;
  requiredHeaders: { 'Content-Type': string; 'Content-Length': string };
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;

  constructor() {
    this.client =
      env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? new S3Client({
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
          })
        : null;
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async createUploadUrl(params: {
    key: string;
    contentType: string;
    contentLength: number;
    allowedContentTypes: readonly string[];
    visibility: StorageVisibility;
    maxBytes?: number;
  }): Promise<ISignedUpload> {
    const { key, contentType, contentLength, allowedContentTypes, visibility } = params;

    if (!allowedContentTypes.includes(contentType)) {
      throw new AppBadRequestException({
        code: ExceptionCode.UnsupportedFileType,
        message: `Unsupported file type. Allowed: ${allowedContentTypes.join(', ')}.`,
      });
    }

    const maxBytes = Math.min(params.maxBytes ?? env.UPLOAD_MAX_BYTES, env.UPLOAD_MAX_BYTES);

    if (contentLength <= 0 || contentLength > maxBytes) {
      throw new AppBadRequestException({
        code: ExceptionCode.FileTooLarge,
        message: `File must be between 1 and ${maxBytes} bytes.`,
      });
    }

    const objectKey = this.buildKey({ key, visibility });
    const url = await getSignedUrl(
      this.requireClient(),
      new PutObjectCommand({
        Bucket: this.requireBucket(),
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      {
        expiresIn: env.UPLOAD_URL_TTL_SECONDS,
        // ! Signing these headers is what makes the size and content type binding; without them they are advisory.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );

    return {
      url,
      key: objectKey,
      expiresInSeconds: env.UPLOAD_URL_TTL_SECONDS,
      requiredHeaders: { 'Content-Type': contentType, 'Content-Length': String(contentLength) },
    };
  }

  async createDownloadUrl({ key, expiresInSeconds }: { key: string; expiresInSeconds?: number }): Promise<string> {
    return await getSignedUrl(this.requireClient(), new GetObjectCommand({ Bucket: this.requireBucket(), Key: key }), {
      expiresIn: expiresInSeconds ?? env.UPLOAD_URL_TTL_SECONDS,
    });
  }

  publicUrl({ key }: { key: string }): string {
    if (!env.S3_PUBLIC_BASE_URL) {
      throw new AppInternalException({ message: 'S3_PUBLIC_BASE_URL is not configured' });
    }

    if (!key.startsWith(`${STORAGE_PREFIXES[StorageVisibility.Public]}/`)) {
      throw new AppInternalException({ message: 'Only objects under the public prefix have a public URL' });
    }

    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }

  async exists({ key }: { key: string }): Promise<boolean> {
    try {
      await this.requireClient().send(new HeadObjectCommand({ Bucket: this.requireBucket(), Key: key }));

      return true;
    } catch {
      return false;
    }
  }

  async delete({ key }: { key: string }): Promise<void> {
    try {
      await this.requireClient().send(new DeleteObjectCommand({ Bucket: this.requireBucket(), Key: key }));
    } catch (error) {
      this.logger.error(`Failed to delete object "${key}": ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  buildKey({ key, visibility }: { key: string; visibility: StorageVisibility }): string {
    return `${STORAGE_PREFIXES[visibility]}/${key.replace(/^\/+/, '')}`;
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new AppInternalException({ message: 'Object storage is not configured (set the S3_* variables)' });
    }

    return this.client;
  }

  private requireBucket(): string {
    if (!env.S3_BUCKET) {
      throw new AppInternalException({ message: 'S3_BUCKET is not configured' });
    }

    return env.S3_BUCKET;
  }
}
