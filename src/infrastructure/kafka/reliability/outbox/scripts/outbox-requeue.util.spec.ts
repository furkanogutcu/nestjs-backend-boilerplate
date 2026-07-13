import { parseRequeueArgs } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.util';

describe('parseRequeueArgs', () => {
  it('requires exactly one selector', () => {
    expect(() => parseRequeueArgs([])).toThrow('one selector is required');
  });

  it.each([
    ['--id', 'e1', '--all'],
    ['--id', 'e1', '--topic', 'session_revoked'],
    ['--topic', 'session_revoked', '--all'],
  ])('rejects mutually exclusive selectors (%s)', (...argv) => {
    expect(() => parseRequeueArgs(argv)).toThrow('mutually exclusive');
  });

  it('parses a single-id selector', () => {
    expect(parseRequeueArgs(['--id', 'e1'])).toEqual({ id: 'e1', topic: undefined, all: false, dryRun: false });
  });

  it('parses a topic selector', () => {
    expect(parseRequeueArgs(['--topic', 'session_revoked'])).toEqual({
      id: undefined,
      topic: 'session_revoked',
      all: false,
      dryRun: false,
    });
  });

  it('parses the all selector with a limit and dry-run', () => {
    expect(parseRequeueArgs(['--all', '--limit', '50', '--dry-run'])).toEqual({
      id: undefined,
      topic: undefined,
      all: true,
      limit: 50,
      dryRun: true,
    });
  });

  it.each(['0', '-1', 'abc'])('rejects a non-positive-integer limit (%s)', (limit) => {
    expect(() => parseRequeueArgs(['--all', '--limit', limit])).toThrow('--limit must be a positive integer');
  });
});
