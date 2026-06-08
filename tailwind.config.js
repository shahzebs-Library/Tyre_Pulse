export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'shimmer':      'shimmer 2s linear infinite',
        'glow-pulse':   'glow-pulse 2.8s ease-in-out infinite',
        'float':        'float 3.2s ease-in-out infinite',
        'spin-slow':    'spin-slow 9s linear infinite',
        'fade-in':      'fadeInUp 0.25s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in-fast': 'fadeIn 0.18s ease-out both',
        'slide-left':   'slideInLeft 0.25s cubic-bezier(0.22,1,0.36,1) both',
        'slide-right':  'slideInRight 0.25s cubic-bezier(0.22,1,0.36,1) both',
        'slide-down':   'slideInDown 0.2s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in':     'scale-in 0.22s cubic-bezier(0.175,0.885,0.32,1.275) both',
        'ping-green':   'ping-green 1.2s cubic-bezier(0,0,0.2,1) infinite',
        'border-flow':  'border-flow 4s ease infinite',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(22,163,74,0.18)' },
          '50%':       { boxShadow: '0 0 50px rgba(22,163,74,0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':       { transform: 'translateY(-5px)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-14px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        slideInDown: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        'ping-green': {
          '75%, 100%': { transform: 'scale(2)', opacity: '0' },
        },
        'border-flow': {
          '0%':   { backgroundPosition: '0% 50%' },
          '50%':  { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
      },
      colors: {
        brand: {
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
      },
      backgroundImage: {
        'green-radial': 'radial-gradient(ellipse at center, rgba(22,163,74,0.15) 0%, transparent 70%)',
        'brand-gradient': 'linear-gradient(135deg, #16a34a 0%, #15803d 55%, #14532d 100%)',
      },
      boxShadow: {
        'glow-sm':  '0 0 20px rgba(22,163,74,0.2)',
        'glow':     '0 0 40px rgba(22,163,74,0.3)',
        'glow-lg':  '0 0 80px rgba(22,163,74,0.35)',
        'card':     '0 1px 2px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.45)',
        'float':    '0 20px 60px rgba(0,0,0,0.6), 0 0 80px rgba(22,163,74,0.08)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        '0': '0ms',
      },
    },
  },
  plugins: [],
}
