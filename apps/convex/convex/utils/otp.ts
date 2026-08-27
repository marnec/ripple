/**
 * Cryptographically random numeric one-time code.
 *
 * Replaces `oslo/crypto`'s `generateRandomString`. The whole oslo family is
 * deprecated on npm — `oslo` points at the successor `@oslojs/*` project, but
 * `@oslojs/crypto` carries a deprecation notice of its own, so the successor
 * would be a lateral move. This is the one function we used from it, and it is
 * ten lines of Web Crypto, which the Convex runtime provides (same approach as
 * `generateShareId` in `shareIds.ts`).
 *
 * Bytes >= 250 are rejected rather than folded: `byte % 10` over a raw byte
 * over-weights digits 0-5, because 256 = 25*10 + 6. Rejection sampling keeps
 * every digit equally likely, which is what makes an 8-digit code worth ~10^8
 * guesses instead of measurably fewer.
 */
export function generateNumericCode(length: number): string {
  // Sized independently of `length`: `getRandomValues` refuses buffers over
  // 65,536 bytes, and the loop refills anyway (~2.3% of draws are rejected).
  const buffer = new Uint8Array(Math.min(Math.max(length, 1), 256));
  let code = "";
  while (code.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= 250) continue;
      code += byte % 10;
      if (code.length === length) break;
    }
  }
  return code;
}
