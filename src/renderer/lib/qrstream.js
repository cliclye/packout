import { makeFrames } from '../../shared/qrframes';

async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Text -> compressed -> numbered frame strings (see shared/qrframes.js for the format). */
export async function framesForText(text, { chunk = 450 } = {}) {
  const compressed = await deflateRaw(new TextEncoder().encode(text));
  return { frames: makeFrames(compressed, { chunk }), compressedBytes: compressed.length };
}
