import type { Config } from "tailwindcss";

// Tremor color names we use in charts — these get dynamically constructed
// so Tailwind JIT purges them unless safelisted
const tremorSafelist = [
  "violet", "amber", "rose", "emerald", "blue", "cyan",
].flatMap((color) =>
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].flatMap((shade) => [
    `fill-${color}-${shade}`,
    `stroke-${color}-${shade}`,
    `bg-${color}-${shade}`,
    `text-${color}-${shade}`,
    `fill-${color}-${shade}/50`,
    `stroke-${color}-${shade}/50`,
  ])
);

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: tremorSafelist,
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Tremor uses these as fallback color mappings
        tremor: {
          brand: {
            faint: "#818cf820",
            muted: "#818cf850",
            subtle: "#818cf8",
            DEFAULT: "#7c3aed",
            emphasis: "#6d28d9",
            inverted: "#ffffff",
          },
          background: {
            muted: "hsl(230 21% 13%)",
            subtle: "hsl(230 16% 20%)",
            DEFAULT: "hsl(230 21% 11%)",
            emphasis: "hsl(230 21% 18%)",
          },
          border: {
            DEFAULT: "hsl(230 16% 20%)",
          },
          ring: {
            DEFAULT: "hsl(230 16% 20%)",
          },
          content: {
            subtle: "hsl(217 15% 55%)",
            DEFAULT: "hsl(210 40% 80%)",
            emphasis: "hsl(210 40% 98%)",
            strong: "hsl(210 40% 98%)",
            inverted: "hsl(230 21% 11%)",
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "tremor-small": "0.375rem",
        "tremor-default": "0.5rem",
        "tremor-full": "9999px",
      },
      fontSize: {
        "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
