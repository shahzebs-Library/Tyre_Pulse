import { motion } from 'framer-motion'
import { cn } from '../lib/cn'
import { useLanguage } from '../contexts/LanguageContext'

export default function LoadingState({ message, fullPage = false }) {
  const { t } = useLanguage()
  const text = message ?? t('common.loading')
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4', fullPage ? 'h-screen' : 'py-20')}>
      {/* Animated ring */}
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-[var(--border-dim)]" />
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: 'var(--brand-bright)',
            borderRightColor: 'rgba(22,163,74,0.3)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        />
        <div
          className="absolute inset-2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(22,163,74,0.12) 0%, transparent 70%)' }}
        />
      </div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="text-sm text-muted"
      >
        {text}
      </motion.p>
    </div>
  )
}
