export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'ui-serif', 'serif'],
      },
      colors: {
        onextap: {
          primary: '#2D4A2D',
          'primary-dark': '#3D5C3D',
          'primary-light': '#5A7A3A',
          'olive-muted': '#E8EFD8',
          'olive-pale': '#C8D8A8',
          dark: '#1A1A14',
          cream: '#F5F2EC',
          'cream-dark': '#EDE9E0',
          bark: '#3A2E1C',
          'bark-mid': '#5C4A2A',
          'bg-light': '#F5F2EC',
          'bg-sidebar': '#EDE9E0',
          night: '#1A2414',
          'night-card': '#243020',
          'night-surface': '#1E2A18',
          muted: '#7A7A64',
          secondary: '#4A4A38',
        },
      },
    },
  },
  plugins: [],
}
