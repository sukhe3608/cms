'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError } = require('./http');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: falls back to storing the validated original */ }

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

// Identify the format from file contents, never from the filename or Content-Type.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const VARIANTS = { card: [500, 300], feature: [800, 500] };

async function processImage(buf, dir) {
  const format = sniff(buf);
  if (!format) throw new HttpError(415, { error: 'unsupported_image', message: 'Upload a JPEG, PNG or WebP image.' });
  const id = crypto.randomBytes(16).toString('hex');

  if (!sharp) {
    const name = `${id}-orig.${EXT[format]}`;
    await fs.writeFile(path.join(dir, name), buf, { flag: 'wx' });
    return { card: `/media/${name}`, feature: `/media/${name}`, optimized: false };
  }

  try {
    // .rotate() applies EXIF orientation; re-encoding then drops all metadata.
    const base = sharp(buf, { limitInputPixels: 40e6, failOn: 'error' }).rotate();
    for (const [key, [w, h]] of Object.entries(VARIANTS)) {
      const out = await base.clone().resize(w, h, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
      await fs.writeFile(path.join(dir, `${id}-${key}.webp`), out, { flag: 'wx' });
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, { error: 'invalid_image', message: 'The image could not be read. Try exporting it again.' });
  }
  return { card: `/media/${id}-card.webp`, feature: `/media/${id}-feature.webp`, optimized: true };
}

module.exports = { processImage, sniff, hasSharp: () => Boolean(sharp) };
