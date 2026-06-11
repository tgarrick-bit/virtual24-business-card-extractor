// Signed-session helpers shared by middleware (edge) and the login route
// (node). Web Crypto only - no node:crypto - so both runtimes can use them.
//
// Cookie value: "<expiryEpochMs>.<hmacHex>" where hmac = HMAC-SHA256(secret,
// "bcx-session:<expiryEpochMs>"). No per-user identity: the whole team shares
// one access code, so the cookie only attests "knew the code, not expired".

export const SESSION_COOKIE = 'bcx_session';
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSessionValue(secret: string, now = Date.now()): Promise<string> {
  const expiry = now + SESSION_TTL_MS;
  return `${expiry}.${await hmacHex(secret, `bcx-session:${expiry}`)}`;
}

export async function verifySessionValue(
  secret: string,
  value: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const expiry = Number(value.slice(0, dot));
  if (!Number.isFinite(expiry) || expiry < now) return false;
  const expected = await hmacHex(secret, `bcx-session:${expiry}`);
  const given = value.slice(dot + 1);
  // Constant-time-ish compare; both sides are fixed-length hex.
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
