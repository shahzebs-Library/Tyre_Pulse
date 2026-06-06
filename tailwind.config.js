export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      animation: {
        'shimmer':     'shimmer 1.8s linear infinite',
        'glow-pulse':  'glow-pulse 2.5s ease-in-out infinite',
        'float':       'float 3s ease-in-out infinite',
        'spin-slow':   'spin-slow 8s linear infinite',
        'fade-in':     'fadeInUp 0.25s ease-out both',
        'slide-left':  'slideInLeft 0.25s ease-out both',
        'ping-green':  'ping-green 1s cubic-bezier(0,0,0.2,1) infinite',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(22,163,74,0.2)' },
          '50%':       { boxShadow: '0 0 40px rgba(22,163,74,0.55)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':       { transform: 'translateY(-4px)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-10px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'ping-green': {
          '75%, 100%': { transform: 'scale(1.8)', opacity: '0' },
        },
      },
      colors: {
        brand: {
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
        },
      },
    },
  },
  plugins: [],
}
