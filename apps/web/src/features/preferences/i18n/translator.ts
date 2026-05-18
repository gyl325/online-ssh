import {
  fallbackTranslations,
  translations,
  type AppLanguage,
  type TranslationDictionary
} from "./translations";

export type TranslationValues = Record<string, string | number>;
export type Translator = (key: string, values?: TranslationValues) => string;

type TranslatorOptions = {
  dictionaries?: Partial<Record<AppLanguage, TranslationDictionary>>;
  fallbackDictionary?: TranslationDictionary;
};

export function interpolateTranslation(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template
  );
}

export function createTranslator(language: AppLanguage, options: TranslatorOptions = {}): Translator {
  const dictionary = options.dictionaries?.[language] || translations[language];
  const fallbackDictionary = options.fallbackDictionary || fallbackTranslations;

  return (key, values) => interpolateTranslation(dictionary[key] || fallbackDictionary[key] || key, values);
}
