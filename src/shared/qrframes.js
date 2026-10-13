/**
 * No-network transfer: the coach pack is deflate-compressed and cut into numbered text frames.
 * Each frame is shown as a QR code; the phone scans the looping sequence and reassembles it.
 *
 *   PK1.<session>.<index>.<total>.<crc32 hex of the whole compressed payload>.<base64 slice>
 *
 * (the base64 alphabet has no '.', so the header splits unambiguously)
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

/** @param compressed Uint8Array of raw-deflate data */
function makeFrames(compressed, { chunk = 900, session } = {}) {
  const id = session || Math.random().toString(16).slice(2, 6).padStart(4, '0');
  const b64 = toBase64(compressed);
  const total = Math.max(1, Math.ceil(b64.length / chunk));
  const crc = crc32(compressed).toString(16).padStart(8, '0');
  const frames = [];
  for (let i = 0; i < total; i++) frames.push(`PK1.${id}.${i}.${total}.${crc}.${b64.slice(i * chunk, (i + 1) * chunk)}`);
  return frames;
}

module.exports = { crc32, makeFrames, toBase64 };
