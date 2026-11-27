import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../hooks/useI18n';
import { ApiError, UnauthorizedError } from '../sync/api';

/** 设置页里的「连接中继」表单。不连接中继时应用照常本地使用。 */
export function PairingForm({
  initialDeviceName,
  onPair,
}: {
  initialDeviceName: string;
  onPair: (code: string, deviceName: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 设备名是从本地库异步读出来的，首次渲染可能是空串，读到后再回填
  useEffect(() => {
    setDeviceName(initialDeviceName);
  }, [initialDeviceName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = deviceName.trim();

    if (trimmedCode.length < 6) {
      setError(t('pairing.codeRequired'));
      return;
    }
    if (!trimmedName) {
      setError(t('pairing.nameRequired'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onPair(trimmedCode, trimmedName);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError(t('pairing.codeInvalid'));
      } else if (err instanceof ApiError) {
        setError(
          err.status === 0 ? err.message : t('pairing.httpError', { status: err.status }),
        );
      } else {
        setError(t('pairing.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pairing-form relay-form" onSubmit={submit}>
      <label>
        {t('pairing.code')}
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t('pairing.codePlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          inputMode="text"
        />
      </label>

      <label>
        {t('pairing.deviceName')}
        <input
          value={deviceName}
          onChange={(event) => setDeviceName(event.target.value)}
          maxLength={64}
          autoComplete="off"
        />
      </label>

      {error ? <div className="form-error">{error}</div> : null}

      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? t('pairing.connecting') : t('pairing.connect')}
      </button>
    </form>
  );
}
