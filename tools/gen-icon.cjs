// Generates a 1024x1024 PNG icon source (icon-source.png) with no external deps.
// ScribeForge motif: a cream "page" with a red bookmark tab and text lines on a slate background.
const fs = require("fs");
const zlib = require("zlib");

const W = 1024;
const H = 1024;

const BG = [44, 62, 80];          // dark slate
const PAGE = [245, 243, 238];     // cream paper
const BOOKMARK = [192, 57, 43];   // red tab
const LINE = [150, 160, 170];     // gray text lines
const ACCENT = [52, 73, 94];      // inner shadow tone

// Rounded-rectangle containment.
function inRRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let nx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  let ny = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

const PX0 = 180, PY0 = 150, PX1 = 844, PY1 = 890, PR = 64;

const lineYs = [380, 470, 560, 650, 740, 830];

// Build raw RGB scanlines (filter byte 0 prefix per row).
const rowLen = 1 + W * 3;
const raw = Buffer.alloc(rowLen * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    let c = BG;
    if (inRRect(x, y, PX0, PY0, PX1, PY1, PR)) {
      c = PAGE;
      // bookmark tab top-left
      if (x >= PX0 && x <= PX0 + 90 && y >= PY0 + 10 && y <= PY0 + 200) c = BOOKMARK;
      // subtle left margin accent
      else if (x >= PX0 + 60 && x <= PX0 + 72 && y >= PY0 + 40 && y <= PY1 - 40) c = ACCENT;
      else {
        for (const ly of lineYs) {
          if (y >= ly && y < ly + 26 && x >= PX0 + 110 && x <= PX1 - 90) {
            c = LINE;
            break;
          }
        }
      }
    }
    raw[p++] = c[0];
    raw[p++] = c[1];
    raw[p++] = c[2];
  }
}

// CRC32 table.
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // color type RGB
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync("icon-source.png", png);
console.log("Wrote icon-source.png (" + png.length + " bytes)");
