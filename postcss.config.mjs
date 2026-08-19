// The legacy build (npm run build:legacy) appends a Lightning CSS downlevel
// pass so Tailwind's built-in oklch palette becomes rgb() for Chrome 109 —
// the newest Chrome that exists for Windows 7. The modern build is left
// untouched and keeps its wide-gamut output.
const isLegacy = process.env.NEXT_PUBLIC_BUILD_VARIANT === "legacy";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    ...(isLegacy ? { "./scripts/postcss-legacy-downlevel.cjs": {} } : {}),
  },
};

export default config;
