/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Vazirmatn", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eef7f2",
          100: "#d6ecdf",
          200: "#aed8bf",
          300: "#7fbf99",
          400: "#4fa172",
          500: "#2f8659",
          600: "#226b47",
          700: "#1c553a",
          800: "#184430",
          900: "#123626",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
};
