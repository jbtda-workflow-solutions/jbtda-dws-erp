import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#EAF3EE',
          500: '#236551',
          700: '#1B4D3E',
          900: '#14382C',
        },
        navy: {
          50: '#F8FAFC',
          500: '#64748B',
          900: '#0F172A',
        },
        badge: {
          paidBg: '#DCFCE7',
          paidText: '#14532D',
          pendingBg: '#FEF3C7',
          pendingText: '#78350F',
          overdueBg: '#FFE4E6',
          overdueText: '#881337',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        numbers: ['"Open Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;

