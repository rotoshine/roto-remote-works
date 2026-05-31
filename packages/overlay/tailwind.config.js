/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // blue-based primary
        primary: {
          DEFAULT: "#2563eb", // blue-600
          fg: "#ffffff",
          hover: "#1d4ed8", // blue-700
        },
      },
    },
  },
  plugins: [],
};
