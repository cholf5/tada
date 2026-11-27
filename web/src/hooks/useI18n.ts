import { useCallback, useSyncExternalStore } from 'react';
import {
  getLang,
  subscribeLang,
  translate,
  type Lang,
  type MessageKey,
  type MessageVars,
} from '../lib/i18n';

/**
 * 订阅界面语言。
 *
 * 翻译函数跟着语言走；语言切换时所有用到它的组件一起重渲染。
 * 非组件代码直接用 `lib/i18n` 的 `t()`，不需要经过 hook。
 */
export function useI18n(): {
  lang: Lang;
  t: (key: MessageKey, vars?: MessageVars) => string;
} {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  const t = useCallback(
    (key: MessageKey, vars?: MessageVars) => translate(lang, key, vars),
    [lang],
  );
  return { lang, t };
}
