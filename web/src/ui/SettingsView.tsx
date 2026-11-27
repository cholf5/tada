import { useEffect, useState, type ChangeEvent } from 'react';
import { backupFilename, createBackup } from '../db/backup';
import { clearQuarantine } from '../db/outbox';
import { getMeta, setMeta, type TadaDb } from '../db/schema';
import { useBranding } from '../hooks/useBranding';
import { useLive } from '../hooks/useLive';
import { applyBrandingToDocument, setCachedBranding } from '../lib/branding';
import { formatLastSync } from '../lib/dates';
import { resizeToPngBase64 } from '../lib/iconResize';
import type { PersistStatus } from '../lib/storage';
import { ApiError, postBranding, type BrandingPayload } from '../sync/api';
import type { SyncEngine, SyncSnapshot } from '../sync/engine';
import { PairingForm } from './PairingForm';
import { SyncBadge } from './SyncBadge';

export function SettingsView({
  db,
  engine,
  sync,
  token,
  connected,
  notice,
  storageStatus,
  onPair,
  onUnpair,
}: {
  db: TadaDb;
  engine: SyncEngine;
  sync: SyncSnapshot;
  token: string | null;
  connected: boolean;
  notice: string | null;
  storageStatus: PersistStatus;
  onPair: (code: string, deviceName: string) => Promise<void>;
  onUnpair: () => void;
}) {
  const storedName = useLive(async () => (await getMeta(db, 'deviceName')) ?? '', [db]) ?? '';
  const lastSyncedAt =
    useLive(async () => (await getMeta(db, 'lastSyncedAt')) ?? null, [db]) ?? null;
  const pending = useLive(() => db.outbox.count(), [db]) ?? 0;
  const quarantined = useLive(() => db.quarantine.count(), [db]) ?? 0;
  const lastSeq = useLive(async () => (await getMeta(db, 'lastSeq')) ?? 0, [db]) ?? 0;

  const [name, setName] = useState(storedName);
  const [saved, setSaved] = useState(false);
  const [reseeded, setReseeded] = useState<number | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    setName(storedName);
  }, [storedName]);

  const saveName = async () => {
    const value = name.trim();
    if (!value) {
      setName(storedName);
      return;
    }
    if (value === storedName) return;
    await setMeta(db, 'deviceName', value);
    setSaved(true);
  };

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  const handleUnpair = () => {
    if (
      window.confirm(
        '解除配对？本地数据会保留，之后仍可照常使用；重新配对后才能继续多端同步。',
      )
    ) {
      onUnpair();
    }
  };

  /** 手动兜底：把所有未删除的本地行重新排队上传（换到空服务器时用） */
  const handleReseed = async () => {
    const count = await engine.reseedLocalData();
    setReseeded(count);
  };

  useEffect(() => {
    if (reseeded === null) return;
    const timer = setTimeout(() => setReseeded(null), 2400);
    return () => clearTimeout(timer);
  }, [reseeded]);

  useEffect(() => {
    if (exported === null) return;
    const timer = setTimeout(() => setExported(null), 3000);
    return () => clearTimeout(timer);
  }, [exported]);

  const persistenceHint =
    storageStatus === 'granted'
      ? '已申请持久化存储，浏览器会尽量保留本地数据。仍建议定期导出备份。'
      : storageStatus === 'denied'
        ? '浏览器未授予持久化存储：清理站点数据或空间紧张时可能丢失。请定期导出备份。'
        : '当前浏览器不支持持久化申请。清理站点数据会丢失本地数据，请定期导出备份。';

  const handleExport = async () => {
    const backup = await createBackup(db);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFilename(new Date(backup.exportedAt));
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(link.download);
  };

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">设置</h1>
      </header>

      {notice ? <div className="banner warning settings-banner">{notice}</div> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">本地数据</div>
            <div className="setting-hint">{persistenceHint}</div>
          </div>
          <div className="setting-control">
            <button type="button" className="btn" onClick={() => void handleExport()}>
              导出备份
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-hint">
            备份是 JSON 文件，包含列表和任务（含已删除墓碑），不包含配对 token。
            {exported ? ` 已导出 ${exported}` : ''}
          </div>
        </div>
      </div>

      {connected ? (
        <div className="settings-card">
          <div className="setting-row">
            <div>
              <div className="setting-label">设备名</div>
              <div className="setting-hint">
                配对时登记到中继；连接后修改只影响本机显示，不会更新服务端记录。
              </div>
            </div>
            <div className="setting-control">
              <input
                value={name}
                aria-label="设备名"
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              {saved ? <span className="saved-hint">已保存</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {connected && token ? <BrandingCard token={token} /> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">中继</div>
            <div className="setting-hint">
              {connected
                ? (sync.lastError ?? '已连接，多端同步在后台进行。')
                : '未连接。数据只保存在这台设备上，连接后可多端同步。'}
            </div>
          </div>
          <div className="setting-control">
            <SyncBadge sync={sync} />
          </div>
        </div>

        {connected ? (
          <>
            <div className="setting-row">
              <div className="setting-label">上次同步</div>
              <div className="setting-value">{formatLastSync(lastSyncedAt)}</div>
            </div>

            <div className="setting-row">
              <div className="setting-label">待同步改动</div>
              <div className="setting-value">{pending} 条</div>
            </div>

            {quarantined > 0 ? (
              <div className="setting-row">
                <div>
                  <div className="setting-label">不合法数据</div>
                  <div className="setting-hint">
                    {quarantined} 条数据不合法，已跳过。数据仍保留在本地，修正后会重新同步。
                  </div>
                </div>
                <div className="setting-control">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void clearQuarantine(db);
                    }}
                  >
                    清除提示
                  </button>
                </div>
              </div>
            ) : null}

            <div className="setting-row">
              <div className="setting-label">同步游标</div>
              <div className="setting-value">{lastSeq}</div>
            </div>
          </>
        ) : (
          <div className="relay-form-wrap">
            <PairingForm initialDeviceName={storedName} onPair={onPair} />
            <p className="settings-footnote relay-footnote">
              配对码由中继一次性签发，10 分钟内有效。不连接也可以正常使用，数据只保存在本机。
            </p>
          </div>
        )}
      </div>

      {connected ? (
        <>
          <div className="settings-actions">
            <button
              type="button"
              className="btn primary"
              disabled={sync.status === 'syncing'}
              onClick={() => {
                void engine.syncNow();
              }}
            >
              {sync.status === 'syncing' ? '同步中…' : '立即同步'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={sync.status === 'syncing'}
              onClick={() => {
                void handleReseed();
              }}
            >
              {reseeded !== null ? `已加入 ${reseeded} 条` : '重新上传本地数据'}
            </button>
            <button type="button" className="btn danger-outline" onClick={handleUnpair}>
              解除配对
            </button>
          </div>

          <p className="settings-footnote">
            「重新上传本地数据」会把本地所有未删除的行重新排队推送，用于换到一台空服务器后补推。
            解除配对只清除本机的 token；任务数据仍保留在本地与中继上。
          </p>
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 实例品牌
 * ------------------------------------------------------------------ */

/** 只在 connected 时挂载：写接口需要 token。 */
function BrandingCard({ token }: { token: string }) {
  const branding = useBranding();
  const [name, setName] = useState(branding.appName);
  const [pendingIcon, setPendingIcon] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(branding.appName);
  }, [branding.appName]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  // 预览 URL 的生命周期跟着 state 走：替换或卸载时 revoke
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const chooseIcon = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const data = await resizeToPngBase64(file);
      setPendingIcon(data);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取图片');
    } finally {
      // 允许再次选择同一个文件
      event.target.value = '';
    }
  };

  const applySavedBranding = (next: Awaited<ReturnType<typeof postBranding>>) => {
    setCachedBranding(next);
    applyBrandingToDocument(next);
    setPendingIcon(null);
    setPreviewUrl(null);
    setSaved(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    const payload: BrandingPayload = {};
    if (trimmed !== branding.appName) {
      if (!trimmed) {
        setError('应用名称不能为空');
        return;
      }
      payload.appName = trimmed;
    }
    if (pendingIcon !== null) payload.icon = { mime: 'image/png', data: pendingIcon };

    if (payload.appName === undefined && payload.icon === undefined) {
      setName(branding.appName);
      setSaved(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      applySavedBranding(await postBranding(token, payload));
    } catch (err) {
      setError(describeBrandingError(err));
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaultIcon = async () => {
    setSaving(true);
    setError(null);
    try {
      applySavedBranding(await postBranding(token, { icon: null }));
    } catch (err) {
      setError(describeBrandingError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="setting-row">
        <div>
          <div className="setting-label">实例品牌</div>
          <div className="setting-hint">
            名称和图标保存在中继上，对所有连接的设备生效；离线设备下次连接后更新。
          </div>
        </div>
        <div className="setting-control">
          <input
            value={name}
            aria-label="应用名称"
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
          {saved ? <span className="saved-hint">已保存</span> : null}
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">应用图标</div>
          <div className="setting-hint">
            只需上传一张正方形图片，浏览器会自动缩成 512×512 的 PNG。
          </div>
          {pendingIcon ? <div className="setting-hint">新图标将在保存后生效</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
        </div>
        <div className="setting-control branding-control">
          {previewUrl ? <img className="brand-preview" src={previewUrl} alt="图标预览" /> : null}
          <input
            type="file"
            className="brand-file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="选择应用图标"
            onChange={(event) => {
              void chooseIcon(event);
            }}
          />
          {branding.hasCustomIcon ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => {
                void restoreDefaultIcon();
              }}
            >
              恢复默认图标
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => {
              void save();
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-hint">
          已添加到主屏幕的应用需要删除后重新添加，名字和图标才会更新。
        </div>
      </div>
    </div>
  );
}

function describeBrandingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '凭证失效，请重新配对';
    if (error.status === 0) return '无法连接服务器';
    if (error.status === 400) return '名称或图片不符合要求';
  }
  return error instanceof Error ? error.message : '保存失败';
}
