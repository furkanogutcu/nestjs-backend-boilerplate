import { isResponseWithinSizeCap } from './http.util';

function responseWith(contentLength: string | null): Response {
  return {
    headers: { get: (name: string) => (name === 'content-length' ? contentLength : null) },
  } as unknown as Response;
}

describe('isResponseWithinSizeCap', () => {
  it('passes when no Content-Length is declared (the fetch timeout bounds the body instead)', () => {
    expect(isResponseWithinSizeCap({ response: responseWith(null), maxBytes: 100 })).toBe(true);
  });

  it('passes a body declared at or under the cap', () => {
    expect(isResponseWithinSizeCap({ response: responseWith('100'), maxBytes: 100 })).toBe(true);
  });

  it('rejects a body declared over the cap', () => {
    expect(isResponseWithinSizeCap({ response: responseWith('101'), maxBytes: 100 })).toBe(false);
  });

  it('passes a non-numeric Content-Length rather than crashing', () => {
    expect(isResponseWithinSizeCap({ response: responseWith('not-a-number'), maxBytes: 100 })).toBe(true);
  });
});
