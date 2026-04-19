/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      colors: {
        sage: {
          50: "#f4faf7",
          100: "#dceee6",
          200: "#b9dcc9",
          500: "#3d8f6f",
          600: "#2f7358",
          700: "#275c47",
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Georgia", "serif"],
        sans: ['"Outfit"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
