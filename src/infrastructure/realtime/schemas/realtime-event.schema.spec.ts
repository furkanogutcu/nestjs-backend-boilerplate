import { realtimeEventSchema } from '@infrastructure/realtime/schemas/realtime-event.schema';

const validEvent = {
  type: 'notification',
  v: 1,
  emitted_at: '2026-06-20T10:00:00.000Z',
  data: { title: 'Hello', unread: 3 },
};

describe('realtimeEventSchema (generic envelope)', () => {
  it('parses a valid push envelope', () => {
    expect(realtimeEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('accepts an envelope without a data payload (data is optional)', () => {
    const { data: _omitted, ...withoutData } = validEvent;

    expect(realtimeEventSchema.parse(withoutData).data).toBeUndefined();
  });

  it('accepts an arbitrary data payload', () => {
    const parsed = realtimeEventSchema.parse({ ...validEvent, data: { nested: { any: ['shape'] }, n: 42 } });

    expect(parsed.data).toEqual({ nested: { any: ['shape'] }, n: 42 });
  });

  it('rejects an empty type', () => {
    expect(realtimeEventSchema.safeParse({ ...validEvent, type: '' }).success).toBe(false);
  });

  it('rejects a non-positive version', () => {
    expect(realtimeEventSchema.safeParse({ ...validEvent, v: 0 }).success).toBe(false);
    expect(realtimeEventSchema.safeParse({ ...validEvent, v: -1 }).success).toBe(false);
  });

  it('rejects a non-integer version', () => {
    expect(realtimeEventSchema.safeParse({ ...validEvent, v: 1.5 }).success).toBe(false);
  });

  it('rejects a non-ISO emitted_at', () => {
    expect(realtimeEventSchema.safeParse({ ...validEvent, emitted_at: 'not-a-date' }).success).toBe(false);
  });
});
