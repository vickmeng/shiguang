import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {}
  },
  plugins: []
} satisfies Config;
