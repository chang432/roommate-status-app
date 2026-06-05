/** @type {import('tailwindcss').Config} */
// Design tokens mirror the original mockups' cozy/homey theme (mockups/styles.css).
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Warm, homey palette
        'bg-top': '#f6ecdd',
        'bg-bottom': '#efdfca',
        card: '#fffdf8',
        ink: '#3d342a',
        'ink-soft': '#8a7c6a',
        line: '#e7dccb',
        accent: '#c97b5a',
        'accent-deep': '#b3613f',
        'accent-soft': '#f3e1d6',
        sage: '#8a9a7b',
        // Status dot colors
        'status-green': '#5aa469',
        'status-red': '#cf6b5e',
        'status-purple': '#9a78b8',
        'status-blue': '#6a86b8',
        'status-amber': '#d39a4f',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '28px',
        md: '18px',
        sm: '12px',
      },
      boxShadow: {
        soft: '0 6px 18px -8px rgba(94, 66, 41, 0.3)',
        card: '0 18px 50px -18px rgba(94, 66, 41, 0.35)',
      },
      keyframes: {
        pulse: {
          '0%': { boxShadow: '0 0 0 0 rgba(90, 164, 105, .5)' },
          '70%': { boxShadow: '0 0 0 9px rgba(90, 164, 105, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(90, 164, 105, 0)' },
        },
      },
      animation: {
        pulse: 'pulse 1.8s infinite',
      },
    },
  },
  plugins: [],
}
