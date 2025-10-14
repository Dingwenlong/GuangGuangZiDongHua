import type { Config } from 'tailwindcss';

const config = {
  content: ['./src/renderer/**/*.{vue,js,ts,jsx,tsx,html}'],
  plugins: [require('tailwindcss-animate')],
  theme: {
    extend: {
      fontFamily: {
        pingfang: ['PingFang SC', 'sans-serif']
      },
      colors: {
        primary: '#001428'
      }
    }
  }
} satisfies Config;

export default config;
