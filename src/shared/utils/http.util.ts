// ! A missing Content-Length passes: only the caller's fetch timeout bounds an unbounded chunked body.
export function isResponseWithinSizeCap({ response, maxBytes }: { response: Response; maxBytes: number }): boolean {
  const contentLength = response.headers.get('content-length');

  if (contentLength === null) {
    return true;
  }

  const declaredBytes = Number(contentLength);

  return !Number.isFinite(declaredBytes) || declaredBytes <= maxBytes;
}
