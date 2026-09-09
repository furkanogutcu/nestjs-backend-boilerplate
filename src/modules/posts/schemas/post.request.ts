import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words separated by single dashes')
  .describe('URL-safe identifier, unique across posts')
  .meta({ example: 'hello-world' });

export const createPostRequestSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(200).describe('Post title').meta({ example: 'Hello world' }),
    body: z.string().trim().min(1).max(50_000).describe('Post body').meta({ example: 'The first paragraph…' }),
  })
  .strict();

export class CreatePostRequest extends createZodDto(createPostRequestSchema) {}

export const updatePostRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional().describe('Post title'),
    body: z.string().trim().min(1).max(50_000).optional().describe('Post body'),
  })
  .strict();

export class UpdatePostRequest extends createZodDto(updatePostRequestSchema) {}
