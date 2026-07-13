// * DI token for the access-token verifier port (an IAccessTokenVerifier). Lives in shared so an infrastructure
// * consumer (the realtime WS handshake) depends only on this token + the interface, never on the domain auth
// * module — the concrete verifier is bound by the auth layer, keeping the modules → infrastructure → shared
// * dependency direction intact (infra never imports a domain module).
export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');
