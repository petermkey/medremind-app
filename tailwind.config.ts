import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0e1013",
        "bg-alt": "#111419",
        surface:  "#14171b",
        surface2: "#191d22",
        blue: {
          DEFAULT: "#d9a53f",
          dark:    "#a67c2a",
        },
        green:  "#8fae74",
        yellow: "#cf8148",
        red:    "#c96a5a",
        purple: "#a292c9",
        pink:   "#c97c98",
        text:   "#e8e6e1",
        muted:  "#9b978f",
      },
      fontFamily: {
        sans: ["Space Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        card:   "16px",
        btn:    "14px",
        sm:     "9px",
        phone:  "44px",
        sheet:  "24px",
      },
      boxShadow: {
        blue: "0 8px 32px rgba(217,165,63,0.25)",
        "blue-sm": "0 4px 20px rgba(217,165,63,0.3)",
        phone: "0 40px 80px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
