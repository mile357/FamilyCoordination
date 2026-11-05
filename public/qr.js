/**
 * Zero-Dependency SVG QR Code Generator (Byte Mode, Error Correction Level L, Versions 1–10)
 * Generates crisp, standards-compliant QR Code SVGs for plain text or URLs up to 271 bytes.
 */

// Total codewords (total) and ECC codewords per single block (ecc) for Versions 1..10 at Level L
// Note: Versions 1..9 at Level L use 1 block; Version 10 uses 2 blocks of (68 data, 18 ecc) + 2 blocks of (69 data, 18 ecc).
// Versions 1..9 give up to 230 bytes of payload in a single RS block, which easily fits URLs & grocery lists.
const VERSION_TABLE_L = [
  null,
  { total: 26, ecc: 7, align: [] },
  { total: 44, ecc: 10, align: [6, 18] },
  { total: 70, ecc: 15, align: [6, 22] },
  { total: 100, ecc: 20, align: [6, 26] },
  { total: 134, ecc: 26, align: [6, 30] },
  { total: 172, ecc: 36, align: [6, 34], blocks: 2 },
  { total: 196, ecc: 40, align: [6, 22, 38], blocks: 2 },
  { total: 242, ecc: 48, align: [6, 24, 42], blocks: 2 },
  { total: 292, ecc: 60, align: [6, 26, 46], blocks: 2 },
  { total: 346, ecc: 72, align: [6, 28, 50], blocks: 4 },
];

// GF(256) tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncodeBlock(dataBytes, eccCount) {
  const gen = rsGeneratorPoly(eccCount);
  const rem = new Uint8Array(eccCount);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    for (let j = 0; j < eccCount - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[eccCount - 1] = gfMul(gen[eccCount], factor);
  }
  return rem;
}

function encodeCodewords(utf8Bytes) {
  // Choose smallest version 1..10 that fits utf8Bytes in Byte mode (4-bit mode + 8/16-bit len + bytes)
  let version = 1;
  for (; version <= 10; version++) {
    const info = VERSION_TABLE_L[version];
    const dataCap = info.total - info.ecc;
    const headerBits = version <= 9 ? 12 : 20;
    const maxBytes = Math.floor((dataCap * 8 - headerBits) / 8);
    if (utf8Bytes.length <= maxBytes) break;
  }
  if (version > 10) {
    version = 10;
    const info = VERSION_TABLE_L[10];
    const maxBytes = info.total - info.ecc - 3;
    utf8Bytes = utf8Bytes.slice(0, maxBytes);
  }

  const info = VERSION_TABLE_L[version];
  const dataCapacity = info.total - info.ecc;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for v1..9, 16 bits for v10)
  pushBits(utf8Bytes.length, version <= 9 ? 8 : 16);
  for (const b of utf8Bytes) pushBits(b, 8);

  // Terminator (up to 4 zero bits)
  const maxDataBits = dataCapacity * 8;
  const term = Math.min(4, maxDataBits - bits.length);
  pushBits(0, term);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(dataCapacity);
  const byteLen = bits.length / 8;
  for (let i = 0; i < byteLen; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    dataWords[i] = v;
  }

  // Pad bytes 0xEC, 0x11
  let padToggle = true;
  for (let i = byteLen; i < dataCapacity; i++) {
    dataWords[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const numBlocks = info.blocks || 1;
  const eccPerBlock = info.ecc / numBlocks;
  const shortBlockLen = Math.floor(dataCapacity / numBlocks);
  const numLongBlocks = dataCapacity % numBlocks;
  const numShortBlocks = numBlocks - numLongBlocks;

  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const bLen = shortBlockLen + (b >= numShortBlocks ? 1 : 0);
    const blockData = dataWords.slice(offset, offset + bLen);
    offset += bLen;
    dataBlocks.push(blockData);
    eccBlocks.push(rsEncodeBlock(blockData, eccPerBlock));
  }

  // Interleave data codewords, then ECC codewords
  const finalWords = [];
  const maxBlockDataLen = shortBlockLen + (numLongBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxBlockDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) finalWords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalWords.push(eccBlocks[b][i]);
    }
  }

  return { version, codewords: finalWords };
}

function buildMatrix(version, codewords) {
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, dark, isReserved = true) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    if (isReserved) reserved[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setModule(r, c, inOuter && (onRing || inCore), true);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  const alignCoords = VERSION_TABLE_L[version].align;
  for (const ar of alignCoords) {
    for (const ac of alignCoords) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(ar + dr, ac + dc, dark, true);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  // Dark module & reserve format info areas
  setModule(4 * version + 9, 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) setModule(8, i, false, true);
    if (!reserved[i][8]) setModule(i, 8, false, true);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) setModule(8, size - 1 - i, false, true);
    if (!reserved[size - 1 - i][8]) setModule(size - 1 - i, 8, false, true);
  }

  // Version Information (Versions 7..10)
  const VERSION_INFO_BITS = {
    7: 0x07c94,
    8: 0x085bc,
    9: 0x09a99,
    10: 0x0a4d3,
  };
  if (version >= 7 && VERSION_INFO_BITS[version]) {
    const vBits = VERSION_INFO_BITS[version];
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setModule(a, b, bit, true);
      setModule(b, a, bit, true);
    }
  }

  // Place data bits in upward/downward 2-column zigzag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!reserved[r][c]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            const word = codewords[bitIdx >>> 3];
            bit = (word >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          // Apply mask 0: (r + c) % 2 === 0
          const maskedBit = (r + c) % 2 === 0 ? bit ^ 1 : bit;
          grid[r][c] = maskedBit;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for Level L (01) + Mask 0 (000) -> 0x77C4
  const formatBits = 0x77c4;
  const getFmtBit = (i) => (formatBits >>> i) & 1;

  for (let i = 0; i <= 5; i++) setModule(8, i, getFmtBit(14 - i), true);
  setModule(8, 7, getFmtBit(8), true);
  setModule(8, 8, getFmtBit(7), true);
  setModule(7, 8, getFmtBit(6), true);
  for (let i = 9; i < 15; i++) setModule(14 - i, 8, getFmtBit(14 - i), true);

  for (let i = 0; i < 8; i++) setModule(8, size - 1 - i, getFmtBit(i), true);
  for (let j = 0; j < 7; j++) setModule(size - 1 - j, 8, getFmtBit(14 - j), true);

  return grid;
}

export function renderQrSvg(text, pixelSize = 148) {
  const raw = new TextEncoder().encode(String(text || " "));
  const { version, codewords } = encodeCodewords(raw);
  const grid = buildMatrix(version, codewords);
  const n = grid.length;
  const quiet = 3;
  const viewSize = n + quiet * 2;

  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c]) {
        path += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" style="background:#FFFFFF; display:block; flex-shrink:0;"><path d="${path}" fill="#000000"/></svg>`;
}
