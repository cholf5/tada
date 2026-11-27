/**
 * 浏览器端图标处理：任意常见图片 → 512×512 PNG → base64。
 *
 * 中继跑在 Workers 里，没有 sharp 之类的图像库，也不该为此引入 wasm；
 * 缩放全部放在保存前的浏览器里完成，中继只存一张 512×512 的 PNG。
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TARGET_SIZE = 512;
const BASE64_CHUNK = 0x8000;

export async function resizeToPngBase64(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('图片不能超过 5 MB');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取图片');
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持图片处理');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // contain：保持比例居中，空白处保持透明
    const scale = Math.min(
      TARGET_SIZE / bitmap.width,
      TARGET_SIZE / bitmap.height,
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.drawImage(
      bitmap,
      Math.round((TARGET_SIZE - width) / 2),
      Math.round((TARGET_SIZE - height) / 2),
      width,
      height,
    );

    const blob = await toPngBlob(canvas);
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    bitmap.close();
  }
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('无法生成图标'));
      }
    }, 'image/png');
  });
}

/** 分块转换，避免一次性把大数组展开进 String.fromCharCode 导致爆栈。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]!);
    }
  }
  return btoa(binary);
}
