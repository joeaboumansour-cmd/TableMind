// The opacity-fallback pass runs for EVERY build: Tailwind's `bg-x/10`
// utilities fall back to FULL opacity on any browser without color-mix(),
// which puts same-coloured text on a solid block. That was reported from a
// real Windows 7 till, on the modern build.
//
// The Lightning CSS downlevel is legacy-only, because it is the pass that
// trades away wide-gamut colour for Chrome 109 compatibility.
const isLegacy = process.env.NEXT_PUBLIC_BUILD_VARIANT === "legacy";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    "./scripts/postcss-opacity-fallback.cjs": {},
    ...(isLegacy ? { "./scripts/postcss-legacy-downlevel.cjs": {} } : {}),
  },
};

export default config;
