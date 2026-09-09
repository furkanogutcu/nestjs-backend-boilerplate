import { z } from 'zod';

export const postResponseSchema = z.object({
  id: z.uuid().describe('Post id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  slug: z.string().describe('URL-safe identifier').meta({ example: 'hello-world' }),
  title: z.string().describe('Post title').meta({ example: 'Hello world' }),
  body: z.string().describe('Post body').meta({ example: 'The first paragraph…' }),
  cover_image_url: z
    .string()
    .nullable()
    .describe('Public URL of the cover image, null when none is set')
    .meta({ example: 'https://cdn.example.com/public/posts/…/cover' }),
  published_at: z
    .string()
    .nullable()
    .describe('When the post went live; null means it is still a draft')
    .meta({ example: '2026-01-01T00:00:00.000Z' }),
  author_id: z.uuid().describe('Who wrote it').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  created_at: z.string().describe('When the post was created').meta({ example: '2026-01-01T00:00:00.000Z' }),
});

export type PostResponse = z.infer<typeof postResponseSchema>;

export const coverUploadResponseSchema = z.object({
  url: z.string().describe('Signed URL to PUT the image to').meta({ example: 'https://bucket.example.com/…' }),
  key: z.string().describe('Storage key the image will live under').meta({ example: 'public/posts/…/cover' }),
  expires_in_seconds: z.number().describe('How long the signed URL stays valid').meta({ example: 300 }),
  required_headers: z
    .record(z.string(), z.string())
    .describe('Headers that must match the signature. Browsers set Content-Length themselves.'),
});

export type CoverUploadResponse = z.infer<typeof coverUploadResponseSchema>;
