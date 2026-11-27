import { useState, type FormEvent } from 'react';
import { ApiError, UnauthorizedError } from '../sync/api';
import { Icon } from './icons';

export function PairingView({
  initialDeviceName,
  notice,
  onPair,
}: {
  initialDeviceName: string;
  notice: string | null;
  onPair: (code: string, deviceName: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(err.status === 0 ? err.message : `配对失败（HTTP ${err.status}）`);
      } else {
        setError('配对失败，请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pairing-screen">
      <div className="pairing-card">
        <div className="brand pairing-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="check" size={15} />
          </span>
          Tada
        </div>

        <div>
          <h1 className="pairing-title">连接你的设备</h1>
          <p className="pairing-hint">
            在服务器上生成一次性配对码，输入后即可开始多端同步。配对一次，之后断网也能正常使用。
          </p>
        </div>

        {notice ? <div className="banner warning">{notice}</div> : null}

        <form className="pairing-form" onSubmit={submit}>
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
            {busy ? '正在配对…' : '配对'}
          </button>
        </form>

        <p className="pairing-foot">配对码由中继一次性签发，10 分钟内有效。</p>
      </div>
    </div>
  );
}
