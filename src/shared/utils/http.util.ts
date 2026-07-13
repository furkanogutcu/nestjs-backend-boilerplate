// * Reject an outbound fetch response whose declared body size exceeds a cap, before it is buffered into memory.
// * Defense-in-depth for calls to pinned hosts (OAuth cert/profile fetches): a compromised-but-allowlisted host
// * cannot stream an oversized body into memory. A missing Content-Length passes here — the caller's fetch timeout
// * bounds an unbounded chunked body instead.
export function isResponseWithinSizeCap({ response, maxBytes }: { response: Response; maxBytes: number }): boolean {
  const contentLength = response.headers.get('content-length');

  if (contentLength === null) {
    return true;
  }

  const declaredBytes = Number(contentLength);

  return !Number.isFinite(declaredBytes) || declaredBytes <= maxBytes;
}
