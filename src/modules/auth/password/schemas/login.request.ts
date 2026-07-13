import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema, passwordSchema } from './credential-fields';

export const loginRequestSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();

export class LoginRequest extends createZodDto(loginRequestSchema) {}
