import {
  createContext, useContext, useEffect, useState, ReactNode,
} from 'react'
import { I18nManager, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'

import en from '../locales/en.json'
import ar from '../locales/ar.json'
import ur from '../locales/ur.json'

export type Language = 'en' | 'ar' | 'ur'

// en.json is the canonical key shape; ar/ur may carry extra keys and are
// resolved at runtime with a key fallback, so a permissive value type is used.
const TRANSLATIONS: Record<Language, Record<string, any>> = { en, ar, ur }
const STORAGE_KEY = 'tp_language'

/** Languages that render right-to-left. */
function isRtlLang(lang: Language): boolean {
  return lang === 'ar' || lang === 'ur'
}

/**
 * Apply RTL layout, but only when it actually changes — flipping I18nManager
 * unnecessarily is wasteful and, on native, a real change needs an app reload
 * to fully take effect (handled by the reload prompt in setLanguage).
 */
function applyRTL(lang: Language) {
  const shouldRTL = isRtlLang(lang)
  if (I18nManager.isRTL === shouldRTL) return
  I18nManager.allowRTL(shouldRTL)
  I18nManager.forceRTL(shouldRTL)
}

interface LanguageContextType {
  language: Language
  isRTL: boolean
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextType | null>(null)

function resolve(obj: Record<string, any>, key: string): string {
  const val = key.split('.').reduce<any>((o, k) => o?.[k], obj)
  return typeof val === 'string' ? val : key
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'ar' || saved === 'ur' || saved === 'en') {
        setLanguageState(saved)
        applyRTL(saved)
      }
    })
  }, [])

  function t(key: string): string {
    return resolve(TRANSLATIONS[language] as Record<string, any>, key)
  }

  function setLanguage(lang: Language) {
    if (lang === language) return
    const langName = lang === 'ar' ? 'العربية' : lang === 'ur' ? 'اردو' : 'English'
    const restartTitle = t('language.restartTitle')
    const restartMsg = t('language.restartMessage')
    const continueLabel = t('language.continue')
    const cancelLabel = t('common.cancel')

    Alert.alert(restartTitle, restartMsg, [
      { text: cancelLabel, style: 'cancel' },
      {
        text: continueLabel,
        onPress: async () => {
          await AsyncStorage.setItem(STORAGE_KEY, lang)
          // Apply the RTL layout direction (guarded to only flip on a change).
          // A native RTL flip only fully applies after a reload, prompted here.
          applyRTL(lang)
          setLanguageState(lang)
          try {
            await Updates.reloadAsync()
          } catch {
            // In dev/Expo Go: Updates.reloadAsync may not be available.
            // The language state is already updated above so strings switch live.
          }
        },
      },
    ])
  }

  const isRTL = isRtlLang(language)

  return (
    <LanguageContext.Provider value={{ language, isRTL, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
