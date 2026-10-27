import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: v("accent"), hover: v("accent-hover") },
        slate: { 50: v("slate-50"), 100: v("slate-100"), 200: v("slate-200"), 300: v("slate-300"), 400: v("slate-400"), 500: v("slate-500"), 600: v("slate-600"), 700: v("slate-700"), 800: v("slate-800"), 900: v("slate-900"), 950: v("slate-950") },
        emerald: { 300: v("em-300"), 400: v("em-400"), 500: v("em-500"), 600: v("em-600"), 950: v("em-950") },
        red: { 400: v("red-400"), 700: v("red-700"), 900: v("red-900"), 950: v("red-950") },
        sky: { 400: v("sky-400"), 500: v("sky-500") },
        amber: { 400: v("amber-400") },
      },
    },
  },
  plugins: [],
};
export default config;
