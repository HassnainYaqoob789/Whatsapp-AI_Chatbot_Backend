const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal pure-JS PNG generator
function createPNG(width, height, getPixel) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

// 512x512 Pixel Renderer for Naracord Speech Bubble Robot Icon
function renderPixel(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Squircle Background (radius = 0.24)
  const cornerR = 0.24;
  const dx = Math.max(0, Math.abs(nx - 0.5) - (0.5 - cornerR));
  const dy = Math.max(0, Math.abs(ny - 0.5) - (0.5 - cornerR));
  const distSq = dx * dx + dy * dy;

  if (distSq > cornerR * cornerR) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Base Gradient: #5850EC -> #3730A3
  const t = (nx + ny) / 2;
  let r = Math.round(88 * (1 - t) + 55 * t);
  let g = Math.round(80 * (1 - t) + 48 * t);
  let b = Math.round(236 * (1 - t) + 163 * t);

  // Antenna: circle at (0.50, 0.18), stem at (0.50, 0.23)
  const antDist = Math.hypot(nx - 0.5, ny - 0.18);
  if (antDist <= 0.055) {
    return [255, 255, 255, 255];
  }
  if (Math.abs(nx - 0.5) <= 0.025 && ny >= 0.20 && ny <= 0.28) {
    return [255, 255, 255, 255];
  }

  // Speech Bubble Body: (x: 0.16 to 0.84, y: 0.28 to 0.76) + tail at bottom-left
  const bblLeft = 0.18, bblRight = 0.82, bblTop = 0.28, bblBottom = 0.74, bblR = 0.16;
  const bdx = Math.max(0, Math.abs(nx - (bblLeft + bblRight)/2) - ((bblRight - bblLeft)/2 - bblR));
  const bdy = Math.max(0, Math.abs(ny - (bblTop + bblBottom)/2) - ((bblBottom - bblTop)/2 - bblR));
  const isInsideBubble = (bdx * bdx + bdy * bdy) <= (bblR * bblR);

  // Tail: triangle from (0.24, 0.70) down to (0.16, 0.88)
  const isTail = (nx >= 0.15 && nx <= 0.32 && ny >= 0.70 && ny <= 0.88 && (ny - 0.70) >= (nx - 0.15) * 1.0);

  if (isInsideBubble || isTail) {
    // White bubble body
    r = 255; g = 255; b = 255;

    // Inner Visor: (x: 0.27 to 0.73, y: 0.42 to 0.64, radius = 0.11)
    const vLeft = 0.28, vRight = 0.72, vTop = 0.42, vBottom = 0.63, vR = 0.10;
    const vdx = Math.max(0, Math.abs(nx - 0.5) - ((vRight - vLeft)/2 - vR));
    const vdy = Math.max(0, Math.abs(ny - (vTop + vBottom)/2) - ((vBottom - vTop)/2 - vR));
    const isInsideVisor = (vdx * vdx + vdy * vdy) <= (vR * vR);

    if (isInsideVisor) {
      // Dark Visor background (#111528)
      r = 17; g = 21; b = 40;

      // Left Eye at (0.39, 0.525) r = 0.055
      const eyeLDist = Math.hypot(nx - 0.39, ny - 0.525);
      if (eyeLDist <= 0.055) {
        // Cyan glow eye (#38BDF8)
        r = 56; g = 189; b = 248;
        // White catchlight at (0.41, 0.505)
        if (Math.hypot(nx - 0.41, ny - 0.505) <= 0.018) {
          r = 255; g = 255; b = 255;
        }
      }

      // Right Eye at (0.61, 0.525) r = 0.055
      const eyeRDist = Math.hypot(nx - 0.61, ny - 0.525);
      if (eyeRDist <= 0.055) {
        // Cyan glow eye (#38BDF8)
        r = 56; g = 189; b = 248;
        // White catchlight at (0.63, 0.505)
        if (Math.hypot(nx - 0.63, ny - 0.505) <= 0.018) {
          r = 255; g = 255; b = 255;
        }
      }

      // Cute Smile slot at (0.50, 0.59)
      if (Math.abs(nx - 0.5) <= 0.04 && Math.abs(ny - 0.59) <= 0.01) {
        r = 99; g = 102; b = 241;
      }
    }
  }

  return [r, g, b, 255];
}

console.log('Rendering 512x512 Naracord Brand PNGs...');
const pngBuffer = createPNG(512, 512, renderPixel);

const targetPaths = [
  path.resolve(__dirname, '../Whatsapp-AI-Chatbot-Frontend/public/naracord-icon.png'),
  path.resolve(__dirname, '../Whatsapp-AI-Chatbot-Frontend/public/favicon.png'),
  path.resolve(__dirname, '../Whatsapp-AI-Chatbot-Frontend/src/assets/naracord-icon.png'),
  'C:\\xampp\\htdocs\\myproject\\wp-content\\plugins\\wabex-ai\\assets\\naracord-icon.png'
];

targetPaths.forEach(target => {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, pngBuffer);
    console.log('Saved PNG to:', target);
  } catch (err) {
    console.error('Error saving to:', target, err.message);
  }
});
console.log('Done generating all brand PNGs!');
