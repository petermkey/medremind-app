import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0D1117",
        "bg-alt": "#111827",
        surface:  "#161B22",
        surface2: "#1C2333",
        blue: {
          DEFAULT: "#3B82F6",
          dark:    "#2563EB",
        },
        green:  "#10B981",
        yellow: "#FBBF24",
        red:    "#EF4444",
        purple: "#8B5CF6",
        pink:   "#EC4899",
        text:   "#F0F6FC",
        muted:  "#8B949E",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card:   "16px",
        btn:    "14px",
        sm:     "9px",
        phone:  "44px",
        sheet:  "24px",
      },
      boxShadow: {
        blue: "0 8px 32px rgba(59,130,246,0.35)",
        "blue-sm": "0 4px 20px rgba(59,130,246,0.4)",
        phone: "0 40px 80px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
