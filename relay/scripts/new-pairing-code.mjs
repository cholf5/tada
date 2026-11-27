#!/usr/bin/env node
// 生成一个一次性配对码，并打印把它写进远端 D1 的命令。
// 用法：npm run pair
import { randomBytes } from 'node:crypto';

const code = randomBytes(5).toString('hex').toUpperCase(); // 10 位十六进制 = 40 bit
const sql = `INSERT INTO pairing_codes (code, expires_at) VALUES ('${code}', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))`;

console.log(`\n配对码: ${code}   （10 分钟内有效，只能用一次）\n`);
console.log('把它写进线上数据库（在仓库根目录执行）：\n');
console.log(
  `  npx wrangler d1 execute tada --remote --config relay/wrangler.toml --command "${sql}"\n`,
);
