/**
 * Code 39 encoder. Every character is nine alternating bars and spaces,
 * three of them wide, so each reference number gets its own scannable pattern.
 */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

export interface Bar {
  x: number;
  width: number;
}

export interface Barcode {
  /** The text that was actually encoded, after cleaning. */
  text: string;
  bars: Bar[];
  /** Total width in narrow-bar units. */
  width: number;
}

/** Builds the bars for a reference number such as "CVE-2026-125350". */
export function encodeBarcode(reference: string | null | undefined): Barcode {
  const text = String(reference ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-. ]/g, '')
    .slice(0, 24);
  if (!text) return { text: '', bars: [], width: 0 };

  const bars: Bar[] = [];
  let x = 0;
  for (const ch of `*${text}*`) {
    const pattern = CODE39[ch];
    for (let i = 0; i < 9; i++) {
      const width = pattern.charAt(i) === 'w' ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
    x += 1; // gap between characters
  }
  return { text, bars, width: x - 1 };
}
