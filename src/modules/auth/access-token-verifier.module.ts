import { Global, Module } from '@nestjs/common';

import { ACCESS_TOKEN_VERIFIER } from '@shared/constants/access-token-verifier.constant';

import { AuthModule } from './auth.module';
import { AccessTokenVerifierService } from './services/access-token-verifier.service';

// * Binds the shared ACCESS_TOKEN_VERIFIER port to the domain adapter, exposing it @Global so an infrastructure
// * entry point (the realtime WS gateway) can inject the verifier WITHOUT importing this domain module — the
// * dependency-inversion wiring that keeps the modules → infrastructure → shared direction intact. The adapter
// * (verify + revocation + claim mapping) lives in AuthModule where TokenService/RevocationService are owned.
@Global()
@Module({
  imports: [AuthModule],
  providers: [AccessTokenVerifierService, { provide: ACCESS_TOKEN_VERIFIER, useExisting: AccessTokenVerifierService }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
export class AccessTokenVerifierModule {}
