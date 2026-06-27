// pageLayout.js — A4 portrait + 16:9 classroom board dimensions (page units).

export const A4_W = 1000;
export const A4_H = 1414;
export const WIDE_W = 1600;
export const WIDE_H = 900;   // 16:9

export function pageFormat(pg) {
  return pg?.format === 'wide' ? 'wide' : 'a4';
}

export function pageW(pg) {
  return pageFormat(pg) === 'wide' ? WIDE_W : A4_W;
}

export function pageH(pg) {
  return pageFormat(pg) === 'wide' ? WIDE_H : A4_H;
}

export function thumbDims(pg, baseW = 56) {
  const pw = pageW(pg), ph = pageH(pg);
  return { w: baseW, h: Math.max(32, Math.round(baseW * ph / pw)) };
}
