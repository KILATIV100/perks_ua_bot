/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fdf4e7',
          100: '#fbe5c3',
          200: '#f7d49b',
          300: '#f3c373',
          400: '#efb24b',
          500: '#D4A574',
          600: '#c49362',
          700: '#a67b4f',
          800: '#88643c',
          900: '#6a4d29',
        },
        coffee: {
          light: '#D4A574',
          DEFAULT: '#8B5A2B',
          dark: '#3E2723',
        },
      },
    },
  },
  plugins: [],
};
