import { detectDeviceName } from '../lib/device';
import { hlcDeviceId, newId } from '../lib/ids';
import { getMeta, setMeta, type TadaDb } from '../db/schema';
import { openWithTimeout } from './open';
import { createPersistentClock, type PersistentClock } from '../sync/clock';

export interface BootResult {
  db: TadaDb;
  deviceId: string;
  deviceName: string;
  clock: PersistentClock;
  token: string | null;
}

const lifecycleBound = new WeakSet<TadaDb>();

/**
 * 处理其他标签页触发的数据库版本升级。
 *
 * - blocked：当前 open 被旧标签页挡住，openWithTimeout 会给出可读错误；
 * - versionchange：别的标签页要升级 schema，本页必须关闭连接让路，
 *   然后重新加载，避免继续用一个即将失效的版本。
 */
function bindDatabaseLifecycle(db: TadaDb): void {
  if (lifecycleBound.has(db)) return;
  lifecycleBound.add(db);

  db.on('blocked', () => {
    console.warn('[tada] 数据库升级被其他标签页阻塞，请关闭其他 Tada 标签页');
  });

  db.on('versionchange', () => {
    console.warn('[tada] 数据库需要升级，正在关闭当前连接');
    db.close();
    if (typeof window !== 'undefined') window.location.reload();
  });
}

/**
 * 打开本地库并补齐设备身份。
 *
 * 幂等：StrictMode 下多次调用不会重复生成 deviceId / deviceName。
 * 时钟从 meta.lastHlc 起步，每次产出都异步落盘；拉到的远端 HLC 会回灌。
 */
export async function bootstrap(db: TadaDb): Promise<BootResult> {
  bindDatabaseLifecycle(db);
  await openWithTimeout(() => db.open());

  let deviceId = await getMeta(db, 'deviceId');
  if (!deviceId) {
    deviceId = newId();
    await setMeta(db, 'deviceId', deviceId);
  }

  let deviceName = await getMeta(db, 'deviceName');
  if (!deviceName) {
    deviceName = detectDeviceName();
    await setMeta(db, 'deviceName', deviceName);
  }

  if ((await getMeta(db, 'lastSeq')) === undefined) {
    await setMeta(db, 'lastSeq', 0);
  }

  const token = (await getMeta(db, 'token')) ?? null;
  const lastHlc = (await getMeta(db, 'lastHlc')) ?? null;

  // 串行写水位，避免多次并发的 put 以乱序落盘；只升不降
  let persistChain: Promise<void> = Promise.resolve();
  const persist = (hlc: string): void => {
    persistChain = persistChain
      .then(async () => {
        const previous = await getMeta(db, 'lastHlc');
        if (!previous || hlc > previous) await setMeta(db, 'lastHlc', hlc);
      })
      .catch((error: unknown) => {
        // 不能静默吞掉：水位写失败会让重启后的 HLC 回退，必须留下可排查的日志
        console.warn('[tada] 保存本地时钟水位失败，下次启动水位可能回退：', error);
      });
  };

  const clock = createPersistentClock({
    device: hlcDeviceId(deviceId),
    initialHlc: lastHlc,
    persist,
  });

  return { db, deviceId, deviceName, clock, token };
}
