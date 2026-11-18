/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F8FC",
        surface: "#FFFFFF",
        ink: "#1D2939",
        "ink-muted": "#667085",
        line: "#EAECF0",
        brand: {
          50: "#F4F2FF",
          100: "#EAE6FF",
          200: "#D4C5FF",
          400: "#9E82FF",
          500: "#5B4CF5",
          600: "#4F22F2",
          700: "#4318D8",
        },
        oxford: {
          DEFAULT: "#13295B",
          deep: "#0A1638",
          accent: "#244696",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "sans-serif"],
        serif: ["Newsreader", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        "card-hover": "0 4px 12px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.04)",
        brand: "0 4px 14px rgba(91, 76, 245, 0.28)",
      },
    },
  },
  plugins: [],
};
