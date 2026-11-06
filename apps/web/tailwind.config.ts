import type { Config } from 'tailwindcss';
import containerQueries from '@tailwindcss/container-queries';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        sunken: v('sunken'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        brand: v('brand'),
        'brand-ink': v('brand-ink'),
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
        accent2: v('accent2'),
        sidebar: v('sidebar'),
        'sidebar-ink': v('sidebar-ink'),
        'sidebar-muted': v('sidebar-muted'),
        'sidebar-active': v('sidebar-active'),
        'chart-1': v('chart-1'),
        'chart-2': v('chart-2'),
        'chart-3': v('chart-3'),
        'chart-4': v('chart-4'),
      },
      fontFamily: { sans: ['Country Flags', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [containerQueries],
} satisfies Config;
