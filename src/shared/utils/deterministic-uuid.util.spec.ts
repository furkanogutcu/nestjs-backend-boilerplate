import { deterministicUuid } from './deterministic-uuid.util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('deterministicUuid', () => {
  it('is deterministic: the same name always yields the same id (the idempotency guarantee)', () => {
    expect(deterministicUuid('user-1:key-1')).toBe(deterministicUuid('user-1:key-1'));
  });

  it('yields a different id for a different name', () => {
    expect(deterministicUuid('user-1:key-1')).not.toBe(deterministicUuid('user-1:key-2'));
  });

  it('produces a well-formed RFC-4122 uuid (version 8, RFC-4122 variant)', () => {
    const id = deterministicUuid('anything');

    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('8');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });
});
