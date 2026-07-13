import { Injectable } from '@nestjs/common';
import crypto from 'crypto';

import { env } from '@config/env.config';
import { AppInternalException } from '@shared/exceptions/internal.exception';

export interface IEncryptParams {
  input: unknown;
  aad?: string | Buffer;
}

export interface IDecryptParams {
  input: string;
  aad?: string | Buffer;
}

@Injectable()
export class SensitiveService {
  private readonly algorithm: crypto.CipherGCMTypes = 'aes-256-gcm';
  private readonly keys: Map<string, Buffer>;
  private readonly activeKid: string;
  private readonly activeKey: Buffer;
  private readonly ivLength = 12;
  private readonly authTagLength = 16;
  private readonly version = 'v1';

  constructor() {
    this.keys = new Map(Object.entries(env.ENCRYPTION_KEYS).map(([kid, hex]) => [kid, Buffer.from(hex, 'hex')]));
    this.activeKid = env.ENCRYPTION_ACTIVE_KID;

    const activeKey = this.keys.get(this.activeKid);

    if (!activeKey) {
      throw new AppInternalException({ message: 'Active encryption key id is not present in the key set' });
    }

    this.activeKey = activeKey;
  }

  encrypt(params: IEncryptParams): string {
    const { input } = params;

    if (input === null || input === undefined) {
      throw new AppInternalException({ message: 'Input cannot be null or undefined' });
    }

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.activeKey, iv, {
      authTagLength: this.authTagLength,
    });

    const aad = this.normalizeAad(params.aad);

    if (aad) {
      cipher.setAAD(aad);
    }

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(input), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('hex');

    return `${this.version}:${this.activeKid}:${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(params: IDecryptParams): unknown {
    const { input } = params;

    if (!input) {
      throw new AppInternalException({ message: 'Input cannot be empty' });
    }

    const [version, kid, ivHex, dataHex] = input.split(':');

    if (version !== this.version || !kid || !ivHex || !dataHex) {
      throw new AppInternalException({ message: 'Invalid encrypted payload format' });
    }

    const key = this.keys.get(kid);

    if (!key) {
      throw new AppInternalException({ message: `Unknown encryption key id "${kid}"` });
    }

    try {
      const iv = Buffer.from(ivHex, 'hex');
      const data = Buffer.from(dataHex, 'hex');

      const authTag = data.subarray(data.length - this.authTagLength);
      const ciphertext = data.subarray(0, data.length - this.authTagLength);

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv, {
        authTagLength: this.authTagLength,
      });

      const aad = this.normalizeAad(params.aad);

      if (aad) {
        decipher.setAAD(aad);
      }

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      if (error instanceof AppInternalException) {
        throw error;
      }

      throw new AppInternalException({ message: 'Failed to decrypt payload' });
    }
  }

  private normalizeAad(aad?: string | Buffer): Buffer | undefined {
    if (aad === undefined) {
      return undefined;
    }

    return typeof aad === 'string' ? Buffer.from(aad, 'utf8') : aad;
  }
}
