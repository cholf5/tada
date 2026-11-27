/** 行 id：UUID v4。优先用平台实现，老环境退回手写版本。 */
export function newId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** HLC 的设备段只允许 4–32 位 [A-Za-z0-9_-]，从 uuid 里取一段十六进制即可。 */
export function hlcDeviceTag(deviceId: string): string {
  const compact = deviceId.replace(/[^A-Za-z0-9_-]/g, '');
  const tag = compact.slice(0, 12);
  return tag.length >= 4 ? tag : compact.padEnd(4, '0');
}

/** 每个页面（标签页）一个随机后缀：共用 deviceId 的多标签页不会产出完全相同的 HLC。 */
export function newTabTag(): string {
  const cryptoObj = globalThis.crypto;
  let tag = '';
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(5);
    cryptoObj.getRandomValues(bytes);
    tag = [...bytes].map((byte) => (byte % 36).toString(36)).join('');
  } else {
    for (let i = 0; i < 5; i += 1) {
      tag += Math.floor(Math.random() * 36).toString(36);
    }
  }
  return tag;
}

/** HLC 设备段：12 位稳定设备前缀 + 5 位标签页后缀，总长 ≤ 32。 */
export function hlcDeviceId(deviceId: string): string {
  return `${hlcDeviceTag(deviceId)}-${newTabTag()}`;
}

