import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema } from './credential-fields';

export const resendVerificationRequestSchema = z.object({ email: emailSchema }).strict();

export class ResendVerificationRequest extends createZodDto(resendVerificationRequestSchema) {}
