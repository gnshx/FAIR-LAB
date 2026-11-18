/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      colors: {
        sidebar: {
          bg: '#0B1120',
          active: '#172036',
          card: '#131B2E',
          border: '#1E293B',
          muted: '#94A3B8',
          label: '#64748B'
        },
        canvas: '#F6F7FB',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#0F172A',
          secondary: '#475569',
          muted: '#64748B',
          subtle: '#94A3B8'
        },
        line: {
          DEFAULT: '#E5E7EB',
          subtle: '#F1F5F9',
          strong: '#CBD5E1'
        },
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA'
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.03)',
        'card-hover': '0 4px 12px rgba(15, 23, 42, 0.06)',
        brand: '0 4px 12px -2px rgba(79, 70, 229, 0.25)'
      }
    }
  },
  plugins: []
};
