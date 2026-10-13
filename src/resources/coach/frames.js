/* Reassembles the looping QR frames Packout shows on screen. Same format as src/shared/qrframes.js:
 *   PK1.<session>.<index>.<total>.<crc32 hex>.<base64 slice>   (slices join into raw-deflate data)
 * Works in the browser and in Node (for tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PackoutFrames = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function fromBase64(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** raw deflate bytes -> text */
  function inflateText(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(ds.readable).text();
  }

  function Assembler() { this.reset(); }
  Assembler.prototype.reset = function () {
    this.session = null; this.total = 0; this.crc = ''; this.chunks = {}; this.count = 0; this.pending = null; this.pendingCount = 0;
  };
  Assembler.prototype.indexes = function () { return Object.keys(this.chunks).map(Number); };

  /** @returns {{state:'progress'|'complete'|'ignored'|'failed', received?:number, total?:number, bytes?:Uint8Array, message?:string}} */
  Assembler.prototype.add = function (payload) {
    if (typeof payload !== 'string' || payload.indexOf('PK1.') !== 0) return { state: 'ignored' };
    var p = payload.split('.');
    if (p.length < 6) return { state: 'ignored' };
    var index = parseInt(p[2], 10), total = parseInt(p[3], 10);
    if (!(total > 0) || !(index >= 0) || index >= total) return { state: 'ignored' };
    var sid = p[1], data = p.slice(5).join('.');
    if (sid !== this.session) {
      // One stray misread must not wipe progress: only switch to a new session when its id repeats.
      if (this.session !== null && this.count > 0) {
        if (sid !== this.pending) { this.pending = sid; this.pendingCount = 1; return { state: 'progress', received: this.count, total: this.total }; }
        this.pendingCount++;
        if (this.pendingCount < 2) return { state: 'progress', received: this.count, total: this.total };
      }
      this.reset(); this.session = sid; this.total = total; this.crc = p[4];
    }
    this.pending = null; this.pendingCount = 0;
    if (total !== this.total) return { state: 'ignored' };
    if (!(index in this.chunks)) { this.chunks[index] = data; this.count++; }
    if (this.count < this.total) return { state: 'progress', received: this.count, total: this.total };
    var b64 = ''; for (var i = 0; i < this.total; i++) b64 += this.chunks[i];
    var bytes;
    try { bytes = fromBase64(b64); } catch (e) { this.reset(); return { state: 'failed', message: 'Corrupt data — scan again.' }; }
    var crc = crc32(bytes).toString(16).padStart(8, '0');
    if (crc !== this.crc) { this.reset(); return { state: 'failed', message: 'A frame was misread — scan again.' }; }
    return { state: 'complete', bytes: bytes };
  };

  return { Assembler: Assembler, crc32: crc32, inflateText: inflateText };
});
