import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          800: '#182823',
          900: '#111E1A',
          950: '#0B1311',
        },
        forest: {
          50: '#EAF3EE',
          100: '#D3E6DC',
          200: '#A8CDB9',
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
          paidBg: '#ECFDF5',
          paidText: '#065F46',
          pendingBg: '#FFFBEB',
          pendingText: '#92400E',
          overdueBg: '#FFF1F2',
          overdueText: '#9F1239',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        numbers: ['"JetBrains Mono"', 'monospace'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
