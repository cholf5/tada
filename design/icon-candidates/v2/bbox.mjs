import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
const INK = {
  '02-seal': '<path d="M 360 510 L 495 645 L 735 395" fill="none" stroke="#000" stroke-width="158" stroke-linecap="round" stroke-linejoin="round"/>',
  '05-signet': '<path d="M 360 470 H 680 M 490 330 V 660 Q 490 710 550 710 Q 610 710 650 665" fill="none" stroke="#000" stroke-width="126" stroke-linecap="round" stroke-linejoin="round"/>',
};
mkdirSync('tmp', { recursive: true });
for (const [name, path] of Object.entries(INK)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${path}</svg>`;
  writeFileSync(`tmp/${name}.svg`, svg);
  await sharp(Buffer.from(svg), { density: 288 }).resize(1024, 1024).png().toFile(`tmp/${name}.png`);
}
console.log('ok');
