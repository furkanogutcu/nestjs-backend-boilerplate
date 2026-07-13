import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { opaqueTokenSchema } from './credential-fields';

export const verifyEmailRequestSchema = z.object({ token: opaqueTokenSchema }).strict();

export class VerifyEmailRequest extends createZodDto(verifyEmailRequestSchema) {}
