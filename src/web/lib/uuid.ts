// |F.4.99.33|Web|Lib/Uuid|TypeScript|src/web/lib/uuid.ts|—|v.0.0.01|Draft|T.0.03.01|
// RFC 4122 v4 UUID с fallback для insecure context (http://LAN-IP).
// crypto.randomUUID() доступен только в secure context (https:// или localhost)
// — в http://192.168.x.x он undefined, и старый код падал с TypeError.
// getRandomValues() работает и в insecure context. Math.random — последний
// рубеж (для idempotency-key / React key криптостойкость не нужна).
export function safeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {bytes[i] = Math.floor(Math.random() * 256);}
  }
  // version 4 + variant 10xx
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {hex.push(bytes[i]!.toString(16).padStart(2, '0'));}
  return (
    hex.slice(0, 4).join('') +
    '-' + hex.slice(4, 6).join('') +
    '-' + hex.slice(6, 8).join('') +
    '-' + hex.slice(8, 10).join('') +
    '-' + hex.slice(10, 16).join('')
  );
}