import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import helmet from 'helmet';

@Global()
@Module({})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        helmet({
          // * JSON-only API: useDefaults:false keeps the policy to exactly these two directives (defaults would re-add script/style/img allowances) so a browser-rendered response can neither load resources nor be framed. Docs UI has its own CSP.
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
