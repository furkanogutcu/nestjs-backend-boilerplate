import { appConfig } from '@config/app.config';

export class CacheKey {
  private static readonly separator = appConfig.redis.separator;

  static join(...parts: (string | number)[]): string {
    return parts.join(CacheKey.separator);
  }
}
