import { useEffect, useState } from 'react';
import { backupFilename, createBackup } from '../db/backup';
import { clearQuarantine } from '../db/outbox';
import { getMeta, setMeta, type TadaDb } from '../db/schema';
import { useI18n } from '../hooks/useI18n';
import { useLive } from '../hooks/useLive';
import { formatLastSync } from '../lib/dates';
import {
  readStoredLangMode,
  setLangMode as applyLangMode,
  type LangMode,
  type MessageKey,
} from '../lib/i18n';
import type { PersistStatus } from '../lib/storage';
import { readStoredThemeMode, setThemeMode, type ThemeMode } from '../lib/theme';
import type { SyncEngine, SyncSnapshot } from '../sync/engine';
import { BrandingCard } from './BrandingCard';
import { PairingForm } from './PairingForm';
import { SyncBadge } from './SyncBadge';

const THEME_OPTIONS: { value: ThemeMode; labelKey: MessageKey }[] = [
  { value: 'system', labelKey: 'theme.system' },
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
];

/** 语言名称按惯例用各自的语言写，不随界面语言变化 */
const LANG_OPTIONS: { value: LangMode; labelKey: MessageKey | null; label: string }[] = [
  { value: 'system', labelKey: 'settings.langSystem', label: '' },
  { value: 'zh', labelKey: null, label: '中文' },
  { value: 'en', labelKey: null, label: 'English' },
];

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
  const { t, lang } = useI18n();
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
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [langMode, setLangModeState] = useState<LangMode>(() => readStoredLangMode());

  const changeTheme = (mode: ThemeMode) => {
    setThemeModeState(mode);
    setThemeMode(mode);
  };

  const changeLanguage = (mode: LangMode) => {
    setLangModeState(mode);
    applyLangMode(mode);
  };

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
    if (window.confirm(t('settings.unpairConfirm'))) {
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
      ? t('settings.persistenceGranted')
      : storageStatus === 'denied'
        ? t('settings.persistenceDenied')
        : t('settings.persistenceUnsupported');

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
        <h1 className="view-title">{t('nav.settings')}</h1>
      </header>

      {notice ? <div className="banner warning settings-banner">{notice}</div> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.appearance')}</div>
            <div className="setting-hint">{t('settings.appearanceHint')}</div>
          </div>
          <div className="setting-control">
            <div
              className="theme-switch"
              role="group"
              aria-label={t('settings.themeGroup')}
            >
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={themeMode === option.value}
                  onClick={() => changeTheme(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.language')}</div>
            <div className="setting-hint">{t('settings.languageHint')}</div>
          </div>
          <div className="setting-control">
            <div
              className="theme-switch"
              role="group"
              aria-label={t('settings.languageGroup')}
            >
              {LANG_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={langMode === option.value}
                  onClick={() => changeLanguage(option.value)}
                >
                  {option.labelKey ? t(option.labelKey) : option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.localData')}</div>
            <div className="setting-hint">{persistenceHint}</div>
          </div>
          <div className="setting-control">
            <button type="button" className="btn" onClick={() => void handleExport()}>
              {t('settings.export')}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-hint">
            {t('settings.backupHint')}
            {exported ? ` ${t('settings.exported', { file: exported })}` : ''}
          </div>
        </div>
      </div>

      {connected ? (
        <div className="settings-card">
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('settings.deviceName')}</div>
              <div className="setting-hint">{t('settings.deviceNameHint')}</div>
            </div>
            <div className="setting-control">
              <input
                value={name}
                aria-label={t('settings.deviceName')}
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
              {saved ? <span className="saved-hint">{t('common.saved')}</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {connected && token ? <BrandingCard token={token} /> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.relay')}</div>
            <div className="setting-hint">
              {connected
                ? (sync.lastError ?? t('settings.relayConnected'))
                : t('settings.relayDisconnected')}
            </div>
          </div>
          <div className="setting-control">
            <SyncBadge sync={sync} />
          </div>
        </div>

        {connected ? (
          <>
            <div className="setting-row">
              <div className="setting-label">{t('settings.lastSync')}</div>
              <div className="setting-value">{formatLastSync(lastSyncedAt, lang)}</div>
            </div>

            <div className="setting-row">
              <div className="setting-label">{t('settings.pending')}</div>
              <div className="setting-value">
                {t('settings.pendingCount', { count: pending })}
              </div>
            </div>

            {quarantined > 0 ? (
              <div className="setting-row">
                <div>
                  <div className="setting-label">{t('settings.quarantined')}</div>
                  <div className="setting-hint">
                    {t('settings.quarantinedHint', { count: quarantined })}
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
                    {t('settings.clearQuarantine')}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="setting-row">
              <div className="setting-label">{t('settings.cursor')}</div>
              <div className="setting-value">{lastSeq}</div>
            </div>
          </>
        ) : (
          <div className="relay-form-wrap">
            <PairingForm initialDeviceName={storedName} onPair={onPair} />
            <p className="settings-footnote relay-footnote">
              {t('settings.pairingFootnote')}
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
              {sync.status === 'syncing' ? t('settings.syncing') : t('settings.syncNow')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={sync.status === 'syncing'}
              onClick={() => {
                void handleReseed();
              }}
            >
              {reseeded !== null
                ? t('settings.reseedDone', { count: reseeded })
                : t('settings.reseed')}
            </button>
            <button type="button" className="btn danger-outline" onClick={handleUnpair}>
              {t('settings.unpair')}
            </button>
          </div>

          <p className="settings-footnote">{t('settings.reseedFootnote')}</p>
        </>
      ) : null}
    </section>
  );
}
