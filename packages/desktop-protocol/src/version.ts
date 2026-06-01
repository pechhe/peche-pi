/**
 * Wire protocol version. Bump when an envelope shape or required field changes
 * in a way that older clients or sidecars would misinterpret.
 *
 * The version is sent in the client `hello` envelope; the sidecar replies
 * with `ready` carrying the same version, or `auth-rejected` with a reason.
 */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
