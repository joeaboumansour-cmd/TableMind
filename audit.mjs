
import { readFileSync, readdirSync } from "node:fs";
const BS = String.fromCharCode(92);
const dir = process.argv[2];
const file = readdirSync(dir).find(f => f.endsWith(".css"));
const css = readFileSync(dir + "/" + file, "utf8");
const chunks = css.split("}");
let solid = 0, fixed = 0;
const bad = [];
for (const c of chunks) {
  if (!c.includes(BS + "/")) continue;
  if (c.includes("color-mix")) continue;
  const m = c.match(/:var\(--(primary|destructive|muted|background|border|ring|secondary|muted-foreground)\)$/);
  if (m) { solid++; if (bad.length < 8) bad.push(c.trim().slice(0,110)); }
  else if (/rgba?\(/.test(c)) fixed++;
}
console.log("opacity utilities with alpha fallback : " + fixed);
console.log("opacity utilities still FULL opacity  : " + solid);
bad.forEach(b => console.log("   " + b + "}"));
