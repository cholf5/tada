import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
const names = process.argv.slice(2);
mkdirSync('out', { recursive: true });
for (const n of names) {
  const svg = readFileSync(`${n}.svg`);
  for (const size of [1024, 512, 256, 128, 48, 32, 24, 16]) {
    await sharp(svg, { density: 288 }).resize(size, size).png().toFile(`out/${n}-${size}.png`);
  }
  console.log('rendered', n);
}
