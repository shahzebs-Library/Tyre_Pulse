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

const TRANSLATIONS: Record<Language, typeof en> = { en, ar, ur }
const STORAGE_KEY = 'tp_language'

interface LanguageContextType {
  language: Language
  isRTL: boolean
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextType | null>(null)

// Resolve a dot-notated key against a nested object
function resolve(obj: Record<string, any>, key: string): string {
  return key.split('.').reduce((o, k) => o?.[k], obj) ?? key
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'ar' || saved === 'ur' || saved === 'en') {
        setLanguageState(saved)
        I18nManager.allowRTL(saved === 'ar' || saved === 'ur')
        I18nManager.forceRTL(saved === 'ar' || saved === 'ur')
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
          I18nManager.allowRTL(lang === 'ar' || lang === 'ur')
          I18nManager.forceRTL(lang === 'ar' || lang === 'ur')
          try {
            await Updates.reloadAsync()
          } catch {
            // In dev/Expo Go: Updates.reloadAsync may not be available
            setLanguageState(lang)
          }
        },
      },
    ])
  }

  const isRTL = language === 'ar' || language === 'ur'

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
