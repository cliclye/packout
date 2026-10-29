/**
 * Maps field coordinates (x, y in 0..1, the tracker's frame before red-on-left
 * mirroring) back onto the video frame, using the same four calibration corners
 * the tracker used to go the other way. Used to draw tracked robots over the
 * match footage.
 *
 * The tracker's corner bisection converges on the projective mapping of the
 * unit square onto the calibration quad, so its inverse is this homography.
 */

/** Homography for (0,0)->TL, (1,0)->TR, (1,1)->BR, (0,1)->BL (Heckbert's square-to-quad). */
function squareToQuad(cal) {
  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = cal;
  const dx1 = p1.x - p2.x; const dx2 = p3.x - p2.x; const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y; const dy2 = p3.y - p2.y; const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y,
    g, h,
  };
}

/** Field point -> normalized video point {x, y} (0..1 of the frame), or null. */
function fieldToImage(H, x, y) {
  if (!H) return null;
  const w = H.g * x + H.h * y + 1;
  if (Math.abs(w) < 1e-9) return null;
  return { x: (H.a * x + H.b * y + H.c) / w, y: (H.d * x + H.e * y + H.f) / w };
}

/**
 * Where a stored path sample is drawn on the field image (0..1). Stored paths
 * are rotated 180° for red-on-left matches so every match shares one
 * orientation; `flip` undoes that so the drawing moves like the video does.
 */
function displayPoint(sample, flip) {
  return flip ? { x: 1 - sample.x, y: 1 - sample.y } : { x: sample.x, y: sample.y };
}

module.exports = { squareToQuad, fieldToImage, displayPoint };
