import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, UnauthorizedError } from '../sync/api';

/** 设置页里的「连接中继」表单。不连接中继时应用照常本地使用。 */
export function PairingForm({
  initialDeviceName,
  onPair,
}: {
  initialDeviceName: string;
  onPair: (code: string, deviceName: string) => Promise<void>;
}) {
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
      setError('请输入完整的配对码');
      return;
    }
    if (!trimmedName) {
      setError('请填写设备名');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onPair(trimmedCode, trimmedName);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError('配对码无效或已过期');
      } else if (err instanceof ApiError) {
        setError(err.status === 0 ? err.message : `连接失败（HTTP ${err.status}）`);
      } else {
        setError('连接失败，请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pairing-form relay-form" onSubmit={submit}>
      <label>
        配对码
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="例如 A1B2C3D4E5"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          inputMode="text"
        />
      </label>

      <label>
        设备名
        <input
          value={deviceName}
          onChange={(event) => setDeviceName(event.target.value)}
          maxLength={64}
          autoComplete="off"
        />
      </label>

      {error ? <div className="form-error">{error}</div> : null}

      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? '正在连接…' : '连接中继'}
      </button>
    </form>
  );
}
