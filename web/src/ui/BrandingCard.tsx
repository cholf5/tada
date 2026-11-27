import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useBranding } from '../hooks/useBranding';
import { useI18n } from '../hooks/useI18n';
import {
  BUILTIN_ICONS,
  CLASSIC_DEFAULT,
  CLASSIC_PRESETS,
  classicIconSvg,
  classicPreview,
  contrastRatio,
  type BuiltinIcon,
  type BuiltinIconId,
} from '../lib/builtinIcons';
import { applyBrandingToDocument, brandIconUrl, setCachedBranding } from '../lib/branding';
import { t } from '../lib/i18n';
import {
  fetchPngBase64,
  resizeToPngBase64,
  svgToPngBase64,
} from '../lib/iconResize';
import { ApiError, postBranding, type BrandingPayload } from '../sync/api';

/**
 * 实例品牌：名称 + 图标都保存在中继上，对所有连接的设备生效。
 *
 * 内置图标不是新的服务端概念：材质类图标是构建时烘焙的 512 PNG，
 * 「经典对勾」在浏览器里按颜色生成 PNG，最后都走与上传图标相同的
 * `/api/branding` 接口。这样 API、D1 和单租户边界都不用动。
 */
export function BrandingCard({ token }: { token: string }) {
  const { t: tr } = useI18n();
  const branding = useBranding();
  const [name, setName] = useState(branding.appName);
  const [pendingIcon, setPendingIcon] = useState<string | null>(null);
  const [pendingPreset, setPendingPreset] = useState<BuiltinIconId | null>(null);
  const [pendingReset, setPendingReset] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [classicPlate, setClassicPlate] = useState(CLASSIC_DEFAULT.plate);
  const [classicMark, setClassicMark] = useState(CLASSIC_DEFAULT.mark);
  const [iconBusy, setIconBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  const currentIconUrl =
    branding.hasCustomIcon && branding.iconVersion !== null
      ? brandIconUrl(192, branding.iconVersion)
      : '/icons/icon-192.png';
  const hasPending = pendingPreset !== null || pendingIcon !== null || pendingReset;
  const classicContrast = contrastRatio(classicPlate, classicMark);

  useEffect(() => {
    setName(branding.appName);
  }, [branding.appName]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  // 预览 URL 的生命周期跟着 state 走：只 revoke 本地选择文件生成的 blob URL
  useEffect(() => {
    if (!previewUrl || !previewUrl.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // 经典对勾：颜色变化时重新生成 SVG 预览，并防抖生成 512 PNG
  useEffect(() => {
    if (pendingPreset !== 'classic') return;

    const request = ++requestRef.current;
    const svg = classicIconSvg(classicPlate, classicMark);
    setPreviewUrl(classicPreview(classicPlate, classicMark));
    setIconBusy(true);
    setError(null);

    const timer = setTimeout(() => {
      void svgToPngBase64(svg)
        .then((png) => {
          if (request === requestRef.current) setPendingIcon(png);
        })
        .catch((err) => {
          if (request !== requestRef.current) return;
          setPendingPreset(null);
          setPendingIcon(null);
          setPreviewUrl(null);
          setError(err instanceof Error ? err.message : tr('branding.errorGenerate'));
        })
        .finally(() => {
          if (request === requestRef.current) setIconBusy(false);
        });
    }, 120);

    return () => clearTimeout(timer);
  }, [pendingPreset, classicPlate, classicMark]);

  const chooseIcon = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 先在本地生成，防止选文件期间旧的经典对勾生成结果把状态覆盖回去
    ++requestRef.current;
    setPendingPreset(null);
    setPendingReset(false);
    setIconBusy(true);
    setError(null);
    setSaved(false);
    try {
      const data = await resizeToPngBase64(file);
      setPendingIcon(data);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('branding.errorReadImage'));
    } finally {
      setIconBusy(false);
      // 允许再次选择同一个文件
      event.target.value = '';
    }
  };

  const selectPreset = async (preset: BuiltinIcon) => {
    if (saving) return;

    // 再次点击已选中的经典对勾：保留上一张已生成的 PNG，不要清空后等一个不会重跑的 effect
    const reclickClassic = pendingPreset === 'classic' && preset.kind === 'classic';

    setError(null);
    setSaved(false);
    setPendingPreset(preset.id);
    setPendingReset(preset.kind === 'default');
    if (!reclickClassic) setPendingIcon(null);

    if (preset.kind === 'default') {
      ++requestRef.current;
      setPreviewUrl(preset.preview);
      setIconBusy(false);
      return;
    }

    // classic 交给上面的 effect：选择时和改颜色时都走同一条生成路径
    if (preset.kind === 'classic') {
      if (reclickClassic) return;
      ++requestRef.current;
      setIconBusy(true);
      return;
    }
    if (!preset.pngUrl) return;

    const request = ++requestRef.current;
    setPreviewUrl(preset.preview);
    setIconBusy(true);
    try {
      const png = await fetchPngBase64(preset.pngUrl);
      if (request === requestRef.current) setPendingIcon(png);
    } catch (err) {
      if (request !== requestRef.current) return;
      setPendingPreset(null);
      setPreviewUrl(null);
      setError(err instanceof Error ? err.message : tr('branding.errorReadBuiltin'));
    } finally {
      if (request === requestRef.current) setIconBusy(false);
    }
  };

  const applySavedBranding = (next: Awaited<ReturnType<typeof postBranding>>) => {
    ++requestRef.current;
    setCachedBranding(next);
    applyBrandingToDocument(next);
    setPendingIcon(null);
    setPendingPreset(null);
    setPendingReset(false);
    setPreviewUrl(null);
    setIconBusy(false);
    setSaved(true);
  };

  const save = async () => {
    if (iconBusy) return;

    const trimmed = name.trim();
    const payload: BrandingPayload = {};
    if (trimmed !== branding.appName) {
      if (!trimmed) {
        setError(tr('branding.nameEmpty'));
        return;
      }
      payload.appName = trimmed;
    }
    if (pendingIcon !== null) {
      payload.icon = { mime: 'image/png', data: pendingIcon };
    } else if (pendingReset && branding.hasCustomIcon) {
      // 选中「签名火漆」= 回到默认图标；没有自定义图标时不必多写一次
      payload.icon = null;
    }

    if (payload.appName === undefined && payload.icon === undefined) {
      setName(branding.appName);
      clearPending();
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
    if (iconBusy) return;
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

  const clearPending = () => {
    ++requestRef.current;
    setPendingIcon(null);
    setPendingPreset(null);
    setPendingReset(false);
    setPreviewUrl(null);
    setIconBusy(false);
    setError(null);
    setSaved(false);
  };

  const updateClassic = (plate: string, mark: string) => {
    setClassicPlate(plate);
    setClassicMark(mark);
    setIconBusy(true);
  };

  const swapClassic = () => updateClassic(classicMark, classicPlate);

  return (
    <div className="settings-card">
      <div className="setting-row">
        <div>
          <div className="setting-label">{tr('branding.title')}</div>
          <div className="setting-hint">{tr('branding.hint')}</div>
        </div>
        <div className="setting-control">
          <input
            value={name}
            aria-label={tr('branding.appName')}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
          {saved ? <span className="saved-hint">{tr('common.saved')}</span> : null}
        </div>
      </div>

      <div className="setting-row is-stacked">
        <div className="brand-head">
          <div>
            <div className="setting-label">{tr('branding.icon')}</div>
            <div className="setting-hint">{tr('branding.iconHint')}</div>
            {hasPending ? (
              <div className="setting-hint">{tr('branding.pendingHint')}</div>
            ) : null}
            {error ? <div className="form-error">{error}</div> : null}
          </div>
          <div className="brand-current">
            <img
              className="brand-preview"
              src={previewUrl ?? currentIconUrl}
              alt={tr('branding.iconPreview')}
            />
            <span className="setting-hint">
              {hasPending ? tr('branding.preview') : tr('branding.current')}
            </span>
          </div>
        </div>

        <div
          className="brand-presets"
          role="group"
          aria-label={tr('branding.builtinGroup')}
        >
          {BUILTIN_ICONS.map((preset) => {
            const active = pendingPreset === preset.id;
            const preview =
              preset.kind === 'classic'
                ? classicPreview(classicPlate, classicMark)
                : preset.preview;
            return (
              <button
                key={preset.id}
                type="button"
                className={`brand-preset${active ? ' is-active' : ''}`}
                aria-pressed={active}
                disabled={saving}
                onClick={() => {
                  void selectPreset(preset);
                }}
              >
                <img src={preview} alt="" />
                <span>{tr(preset.labelKey)}</span>
                {preset.hintKey ? <em>{tr(preset.hintKey)}</em> : null}
              </button>
            );
          })}
        </div>

        {pendingPreset === 'classic' ? (
          <div className="brand-classic">
            <div className="brand-colors">
              <label className="brand-color">
                {tr('branding.plate')}
                <input
                  type="color"
                  value={classicPlate}
                  aria-label={tr('branding.plateAria')}
                  onChange={(event) => updateClassic(event.target.value, classicMark)}
                />
              </label>
              <label className="brand-color">
                {tr('branding.mark')}
                <input
                  type="color"
                  value={classicMark}
                  aria-label={tr('branding.markAria')}
                  onChange={(event) => updateClassic(classicPlate, event.target.value)}
                />
              </label>
              <button type="button" className="btn" onClick={swapClassic}>
                {tr('branding.swap')}
              </button>
            </div>

            <div
              className="brand-swatches"
              role="group"
              aria-label={tr('branding.paletteGroup')}
            >
              {CLASSIC_PRESETS.map((item) => {
                const active =
                  item.colors.plate.toLowerCase() === classicPlate.toLowerCase() &&
                  item.colors.mark.toLowerCase() === classicMark.toLowerCase();
                return (
                  <button
                    key={item.labelKey}
                    type="button"
                    className={`brand-swatch${active ? ' is-active' : ''}`}
                    title={tr(item.labelKey)}
                    aria-label={tr(item.labelKey)}
                    aria-pressed={active}
                    onClick={() => updateClassic(item.colors.plate, item.colors.mark)}
                  >
                    <img
                      src={classicPreview(item.colors.plate, item.colors.mark)}
                      alt=""
                    />
                  </button>
                );
              })}
            </div>

            <div
              className={`setting-hint${classicContrast < 3 ? ' brand-warning' : ''}`}
            >
              {tr('branding.contrast', { ratio: classicContrast.toFixed(1) })}
              {classicContrast < 3 ? tr('branding.contrastLow') : tr('branding.contrastOk')}
            </div>
          </div>
        ) : null}

        <div className="brand-actions">
          <input
            type="file"
            className="brand-file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={tr('branding.chooseIcon')}
            disabled={saving}
            onChange={(event) => {
              void chooseIcon(event);
            }}
          />
          {hasPending ? (
            <button type="button" className="btn" onClick={clearPending}>
              {tr('branding.cancel')}
            </button>
          ) : null}
          {branding.hasCustomIcon ? (
            <button
              type="button"
              className="btn"
              disabled={saving || iconBusy}
              onClick={() => {
                void restoreDefaultIcon();
              }}
            >
              {tr('branding.restoreDefault')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={saving || iconBusy}
            onClick={() => {
              void save();
            }}
          >
            {saving
              ? tr('branding.saving')
              : iconBusy
                ? tr('branding.generating')
                : tr('branding.save')}
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-hint">{tr('branding.homeScreenHint')}</div>
      </div>
    </div>
  );
}

function describeBrandingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t('branding.errorUnauthorized');
    if (error.status === 0) return t('branding.errorNetwork');
    if (error.status === 400) return t('branding.errorInvalid');
  }
  return error instanceof Error ? error.message : t('branding.errorSave');
}
