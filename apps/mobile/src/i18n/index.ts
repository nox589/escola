import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ca } from './ca';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';

export const UI_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ca', label: 'Català' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
] as const;

const supported = UI_LANGUAGES.map((l) => l.code) as string[];
const device = getLocales()[0]?.languageCode ?? 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ca: { translation: ca },
    de: { translation: de },
    fr: { translation: fr },
    it: { translation: it },
  },
  lng: supported.includes(device) ? device : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const LANG_NAMES: Record<string, string> = {
  ca: 'Català',
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
};

export default i18n;
