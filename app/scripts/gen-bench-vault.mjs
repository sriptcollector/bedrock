// Generates a synthetic vault for index benchmarks: node scripts/gen-bench-vault.mjs <dir> [count]
import fs from "node:fs";
import path from "node:path";
const [dir, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 10000);
fs.rmSync(dir, { recursive: true, force: true });
const words = "stone layer river note idea plan sketch garden north quiet amber field window paper signal".split(" ");
const w = (i) => words[i % words.length];
for (let i = 0; i < count; i++) {
  const folder = path.join(dir, `Area ${i % 25}`, `Topic ${i % 7}`);
  fs.mkdirSync(folder, { recursive: true });
  const links = [1, 7, 31, 211].map((k) => `[[Note ${(i * k + 3) % count}]]`).join(", ");
  const body = [
    "---",
    `tags: [${w(i)}, ${w(i + 3)}/sub]`,
    `created: 2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    `rating: ${i % 5}`,
    "---",
    `# Note ${i}`,
    "",
    `Some ${w(i)} text about ${w(i + 1)} and ${w(i + 2)}. Links: ${links}. Tag #${w(i + 5)}.`,
    "",
    "## Tasks",
    `- [ ] ${w(i)} task`,
    `- [x] ${w(i + 1)} done ^t${i}`,
    "",
    "## Notes",
    ...Array.from({ length: 12 }, (_, k) => `Paragraph ${k} with **${w(i + k)}** and ==${w(i + k + 1)}== and [[Missing ${i % 50}]].`),
    "",
    "```js",
    `const n = ${i};`,
    "```",
  ].join("\n");
  fs.writeFileSync(path.join(folder, `Note ${i}.md`), body);
}
console.log(`wrote ${count} notes to ${dir}`);
