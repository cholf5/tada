import { useEffect, useRef, useState } from 'react';
import { bootstrap } from './db/bootstrap';
import type { RepoDeps } from './db/repo';
import { createDb, setMeta, type TadaDb } from './db/schema';
import { useBranding } from './hooks/useBranding';
import { useI18n } from './hooks/useI18n';
import { initBranding } from './lib/branding';
import type { MessageKey } from './lib/i18n';
import { requestPersistentStorage, type PersistStatus } from './lib/storage';
import { createHttpTransport, pairDevice } from './sync/api';
import { SyncEngine, type SyncSnapshot } from './sync/engine';
import { Workspace } from './ui/Workspace';

interface BootState {
  db: TadaDb;
  deps: RepoDeps;
  engine: SyncEngine;
}

export default function App() {
  const { t } = useI18n();
  const [boot, setBoot] = useState<BootState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [sync, setSync] = useState<SyncSnapshot>({ status: 'unpaired', lastError: null });
  const [storageStatus, setStorageStatus] = useState<PersistStatus>('unsupported');
  const initRef = useRef(false);
  const branding = useBranding();

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    // 品牌与数据库 bootstrap 并行，不阻塞启动
    void initBranding();
    const db = createDb();
    bootstrap(db)
      .then((result) => {
        // 尽早申请持久化存储；结果只影响设置页提示，不阻塞启动
        void requestPersistentStorage().then(setStorageStatus);

        const engine = new SyncEngine({
          db,
          clock: result.clock,
          transport: createHttpTransport(),
          onUnauthorized: () => {
            setNotice('app.sessionExpired');
            setToken(null);
          },
        });

        engine.subscribe((snapshot) => setSync(snapshot));
        engine.start();

        setToken(result.token);
        setBoot({ db, deps: { db, clock: result.clock }, engine });
      })
      .catch((error: unknown) => {
        setBootError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const handlePair = async (code: string, name: string) => {
    if (!boot) return;
    const nextToken = await pairDevice(code, name);
    await setMeta(boot.db, 'token', nextToken);
    await setMeta(boot.db, 'deviceName', name);
    // SPEC：配对后做一次全量 pull
    await setMeta(boot.db, 'lastSeq', 0);
    // 标记本次配对：若服务器是空的，同步引擎会把本地数据重新入队补推
    await setMeta(boot.db, 'pairReseed', 1);

    setToken(nextToken);
    setNotice(null);
    void boot.engine.syncNow();
  };

  const handleUnpair = async () => {
    if (!boot) return;
    await setMeta(boot.db, 'token', null);
    // 与配对时的重置语义保持一致：解除配对后游标归零，下次配对从头全量拉取。
    // 之前只靠 handlePair 重置，行为等价但不够显式。
    await setMeta(boot.db, 'lastSeq', 0);
    setToken(null);
    setNotice(null);
    void boot.engine.syncNow();
  };

  if (bootError) {
    return (
      <div className="splash">
        <div className="brand">{branding.appName}</div>
        <p className="splash-title">{t('app.dbOpenFailed')}</p>
        <p className="splash-hint">{bootError}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          {t('common.reload')}
        </button>
      </div>
    );
  }

  if (!boot) {
    return (
      <div className="splash">
        <div className="brand">{branding.appName}</div>
        <p className="splash-hint">{t('app.loading')}</p>
      </div>
    );
  }

  return (
    <Workspace
      db={boot.db}
      deps={boot.deps}
      engine={boot.engine}
      sync={sync}
      token={token}
      connected={token !== null}
      notice={notice ? t(notice) : null}
      storageStatus={storageStatus}
      onPair={handlePair}
      onUnpair={() => {
        void handleUnpair();
      }}
    />
  );
}
