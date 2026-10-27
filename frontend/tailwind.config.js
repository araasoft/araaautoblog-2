/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: ["selector", ':root[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        ink: "var(--ink)",
        mut: "var(--mut)",
        line: "var(--line)",
        pri: "var(--pri)",
        pri2: "var(--pri2)",
        pale: "var(--pale)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        fb: "var(--fb)",
        li: "var(--li)",
      },
      boxShadow: { soft: "var(--sh)" },
    },
  },
  plugins: [],
};
