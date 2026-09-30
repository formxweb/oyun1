// Snapshot interpolation helpers.
export const INTERP_MS = 110;
export function pushSample(ent, t, arr) {
  const b = (ent.buf ||= []);
  if (b.length && t <= b[b.length - 1].t) return;
  b.push({ t, a: arr });
  if (b.length > 8) b.shift();
}
function angLerp(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; }
/** Returns interpolated array (angle indices interpolated shortest-way). */
export function sample(ent, rt, angleIdx = []) {
  const b = ent.buf;
  if (!b || !b.length) return null;
  if (rt <= b[0].t) return b[0].a;
  const last = b[b.length - 1];
  if (rt >= last.t) return last.a;
  for (let i = b.length - 1; i > 0; i--) {
    if (b[i - 1].t <= rt) {
      const A = b[i - 1], B = b[i], k = (rt - A.t) / Math.max(1, B.t - A.t);
      const out = new Array(A.a.length);
      for (let j = 0; j < out.length; j++) out[j] = angleIdx.includes(j) ? angLerp(A.a[j], B.a[j], k) : (typeof A.a[j] === 'number' ? A.a[j] + (B.a[j] - A.a[j]) * k : B.a[j]);
      return out;
    }
  }
  return last.a;
}
