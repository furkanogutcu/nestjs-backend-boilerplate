import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema } from './credential-fields';

export const forgotPasswordRequestSchema = z.object({ email: emailSchema }).strict();

export class ForgotPasswordRequest extends createZodDto(forgotPasswordRequestSchema) {}
