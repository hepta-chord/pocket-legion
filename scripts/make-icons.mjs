// 依存ゼロで PNG アイコンを作る。pocket-rogue の scripts/make-icons.mjs と同じ方式。
// 尖った先端を持つ盾のドット絵を、アプリの --bg / --fg (style.css) に塗って描く。
// 実行: node scripts/make-icons.mjs  (public/icon-192.png と public/icon-512.png を上書きする)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GLYPH = [
  '...#####...',
  '..#######..',
  '.#########.',
  '###########',
  '###########',
  '###########',
  '.#########.',
  '..#######..',
  '...#####...',
  '....###....',
  '.....#.....',
];
const BG = [0x0d, 0x11, 0x17];
const FG = [0xc9, 0xd1, 0xd9];

function makePng(size) {
  const gw = GLYPH[0].length;
  const gh = GLYPH.length;
  const scale = Math.floor((size * 0.7) / Math.max(gw, gh));
  const offX = Math.floor((size - gw * scale) / 2);
  const offY = Math.floor((size - gh * scale) / 2);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - offX) / scale);
      const gy = Math.floor((y - offY) / scale);
      const on = gx >= 0 && gy >= 0 && gx < gw && gy < gh && GLYPH[gy][gx] === '#';
      const c = on ? FG : BG;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
      raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), makePng(size));
  console.log(`wrote public/icon-${size}.png`);
}
