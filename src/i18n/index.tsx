import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { zhCN, type TranslationKey } from './zh-CN';
import { enUS } from './en-US';

export type { TranslationKey } from './zh-CN';

export type Language = 'zh' | 'en';
export type TranslationParams = Record<string, string | number>;

type Dict = Record<string, string | { one: string; other: string }>;

const STORAGE_KEY = 'layerive-language';
const LOCALES: Record<Language, Dict> = { zh: zhCN, en: enUS };
const HTML_LANG: Record<Language, string> = { zh: 'zh-CN', en: 'en-US' };
const DOC_TITLES: Record<Language, string> = {
  zh: 'Layerive · 本地 AI 图片工作台',
  en: 'Layerive · Local AI Image Studio',
};

// Electron 主进程通过 preload 桥接收语言变化以重建原生菜单；浏览器环境不存在该对象。
declare global {
  interface Window {
    layeriveI18n?: { setLanguage: (language: Language) => void };
  }
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => (name in params ? String(params[name]) : token));
}

function pickTemplate(value: string | { one: string; other: string }, params?: TranslationParams): string {
  if (typeof value === 'string') return value;
  const count = params?.count;
  return typeof count === 'number' && count === 1 ? value.one : value.other;
}

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const value = LOCALES[language][key] ?? zhCN[key];
  return interpolate(pickTemplate(value, params), params);
}

// 动态 key（服务端错误码 / 消息码）：查不到时回退给定文案，供 err.* / msg.* 使用。
export function translateKey(language: Language, key: string, fallback: string, params?: TranslationParams): string {
  const value = LOCALES[language][key] ?? (zhCN as Dict)[key];
  if (value === undefined) return interpolate(fallback, params);
  return interpolate(pickTemplate(value, params), params);
}

let activeLanguage: Language = 'zh';

export function currentLanguage(): Language {
  return activeLanguage;
}

// 非 React 模块（api.ts 等）取词入口；语言由 LanguageProvider 在渲染与 effect 中同步。
export function tf(key: string, fallback: string, params?: TranslationParams): string {
  return translateKey(activeLanguage, key, fallback, params);
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  tf: (key: string, fallback: string, params?: TranslationParams) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: 'zh',
  setLanguage: () => {},
  t: (key, params) => translate('zh', key, params),
  tf: (key, fallback, params) => translateKey('zh', key, fallback, params),
});

function initialLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'; }
  catch { return 'zh'; }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  activeLanguage = language;

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[language];
    document.title = DOC_TITLES[language];
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* private mode */ }
    window.layeriveI18n?.setLanguage(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);
  const t = useCallback((key: TranslationKey, params?: TranslationParams) => translate(language, key, params), [language]);
  const tf = useCallback((key: string, fallback: string, params?: TranslationParams) => translateKey(language, key, fallback, params), [language]);
  const value = useMemo(() => ({ language, setLanguage, t, tf }), [language, setLanguage, t, tf]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

// 顶栏语言切换按钮：显示目标语言缩写，模式对齐 theme-toggle。
export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();
  const target: Language = language === 'zh' ? 'en' : 'zh';
  return (
    <button type="button" className="icon-button language-toggle" onClick={() => setLanguage(target)} title={t('app.switchLanguage')} aria-label={t('app.switchLanguage')}>
      {target === 'en' ? 'EN' : '中'}
    </button>
  );
}
