#!/usr/bin/env node
// 从 public/icons/maskable-source.svg 重新生成所有位图图标。
// 用法：npm run icons（在 web/ 下）或 npm run icons（仓库根目录）
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(webRoot, 'public', 'icons', 'maskable-source.svg');
const source = await readFile(sourcePath);

const targets = [
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'public/icons/maskable-512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
];

for (const target of targets) {
  const output = join(webRoot, target.file);
  await sharp(source, { density: 288 })
    .resize(target.size, target.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`generated ${target.file} (${target.size}x${target.size})`);
}

console.log(`source: ${sourcePath}`);
