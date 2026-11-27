/**
 * 浏览器端图标处理：任意常见图片 → 512×512 PNG → base64。
 *
 * 中继跑在 Workers 里，没有 sharp 之类的图像库，也不该为此引入 wasm；
 * 缩放全部放在保存前的浏览器里完成，中继只存一张 512×512 的 PNG。
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TARGET_SIZE = 512;
const BASE64_CHUNK = 0x8000;

/** 与 relay/src/branding.ts 的 MAX_ICON_BYTES 保持一致：中继只收 512 KiB。 */
const MAX_ICON_BYTES = 512 * 1024;

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
    return blobToBase64(blob);
  } finally {
    bitmap.close();
  }
}

/**
 * 把内置图标（SVG 模板）栅格化成 512 PNG。
 *
 * 只给「经典对勾」这类纯色形状用：不依赖浏览器对 SVG 滤镜/图案的差异，
 * 材质类的内置图标在构建时已经烘焙成 PNG，走 fetchPngBase64。
 */
export async function svgToPngBase64(svg: string): Promise<string> {
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持图片处理');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, TARGET_SIZE, TARGET_SIZE);

    return blobToBase64(await toPngBlob(canvas));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 读取构建时烘焙的 512 PNG，转成和上传图标相同的 base64。 */
export async function fetchPngBase64(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error('无法读取内置图标');
  }
  if (!response.ok) throw new Error('无法读取内置图标');

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ICON_BYTES) {
    throw new Error('内置图标超过 512 KiB');
  }
  return bytesToBase64(bytes);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法生成图标'));
    image.src = url;
  });
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

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_ICON_BYTES) {
    throw new Error('生成的图标超过 512 KiB，请换一张更简单的图片');
  }
  return bytesToBase64(bytes);
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
