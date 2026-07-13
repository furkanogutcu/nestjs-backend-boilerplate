import { z } from 'zod';

// * Generic server→client push envelope. Every realtime push carries a `type` discriminator (the client routes
// * or ignores by it), a `v` contract version (bump only on a breaking reshape of the same `type`; a new push
// * kind is a new `type`), the emit instant, and an arbitrary `data` payload. Concrete features narrow `data`
// * per `type` — this base envelope is the extension surface. snake_case on the wire like every response body.
export const realtimeEventSchema = z.object({
  type: z.string().min(1).meta({ example: 'notification' }),
  v: z.number().int().positive().meta({ example: 1 }),
  emitted_at: z.iso.datetime().meta({ example: '2026-06-20T10:00:00.000Z' }),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
