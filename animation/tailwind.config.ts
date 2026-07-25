import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: "#00f0ff",
          pink: "#ff00ff",
          green: "#00ff41",
          yellow: "#f0ff00",
          purple: "#a855f7",
        },
        dark: {
          bg: "#0a0a0f",
          panel: "rgba(0, 20, 40, 0.85)",
          glass: "rgba(5, 15, 30, 0.65)",
        }
      },
      fontFamily: {
        orbitron: ["var(--font-orbitron)", "sans-serif"],
        rajdhani: ["var(--font-rajdhani)", "sans-serif"],
        mono: ["var(--font-share-tech-mono)", "monospace"],
      },
      animation: {
        'neon-pulse': 'neon-pulse 2s ease-in-out infinite',
        'glow-bloom': 'glow-bloom 2.5s ease-in-out infinite',
        'card-float': 'card-idle-float 3s ease-in-out infinite',
        'hud-flicker': 'hud-flicker 4s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
        'avatar-ring': 'avatar-ring-spin 4s linear infinite',
        'cursor-blink': 'cursor-blink 1s step-end infinite',
        'corner-pulse': 'corner-pulse 3s ease-in-out infinite',
        'status-blink': 'status-blink 2s ease-in-out infinite',
        'hex-pulse': 'hex-pulse 4s ease-in-out infinite',
        'glitch-text': 'glitch-text 3s ease-in-out infinite',
        'icon-glow': 'icon-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
