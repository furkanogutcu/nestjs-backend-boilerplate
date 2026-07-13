import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { opaqueTokenSchema, passwordSchema } from './credential-fields';

export const resetPasswordRequestSchema = z.object({ token: opaqueTokenSchema, password: passwordSchema }).strict();

export class ResetPasswordRequest extends createZodDto(resetPasswordRequestSchema) {}
