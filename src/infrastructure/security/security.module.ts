import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import helmet from 'helmet';

@Global()
@Module({})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        helmet({
          // ! useDefaults:false — the defaults re-add script/style/img allowances this JSON-only API must not grant.
          contentSecurityPolicy: {
            useDefaults: false,
            directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
          },
          frameguard: { action: 'deny' },
          hsts: { maxAge: 31536000, includeSubDomains: true },
        }),
      )
      .forRoutes('*');
  }
}
