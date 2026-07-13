import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema, passwordSchema } from './credential-fields';

export const registerRequestSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();

export class RegisterRequest extends createZodDto(registerRequestSchema) {}
