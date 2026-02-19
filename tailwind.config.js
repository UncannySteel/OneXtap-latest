export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'onextap': {
          'primary': '#8c9657',
          'dark': '#473f34',
          'cream': '#f0e5c7',
          'primary-dark': '#6d7543',
          'primary-light': '#a8b375',
          'bg-light': '#faf9f6',
          'bg-sidebar': '#f5f3ed',
          'night': '#1c1b18',
          'night-card': '#262520',
          'night-surface': '#2a2924',
        },
      },
    },
  },
  plugins: [],
}
