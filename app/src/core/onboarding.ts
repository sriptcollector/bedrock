// First-run onboarding, the pure parts (no DOM, no Electron; unit tested):
// - the two prompts the person gives their Claude (with the real vault path filled in),
// - the "Bedrock/Instructions for Claude.md" file Bedrock uses to leave requests for Claude,
// - life areas, graph gradient schemes and the graph.json colour groups they turn into.
// The modal itself lives in renderer/onboarding/.

/** Vault-relative path of the file Bedrock writes requests into and Claude checks off. */
export const INSTRUCTIONS_PATH = "Bedrock/Instructions for Claude.md";

// ---------- life areas and graph colours ----------

export interface Area {
  name: string;
  /** lowercase slug used in the `area/<slug>` tag */
  slug: string;
}

export const AREAS: Area[] = [
  { name: "Work", slug: "work" },
  { name: "Projects", slug: "projects" },
  { name: "Health", slug: "health" },
  { name: "Money", slug: "money" },
  { name: "Learning", slug: "learning" },
  { name: "People", slug: "people" },
  { name: "Personal", slug: "personal" },
];

export interface GradientScheme {
  id: string;
  name: string;
  /** one strong colour per area, in AREAS order */
  colors: string[];
}

export const GRADIENT_SCHEMES: GradientScheme[] = [
  { id: "ocean", name: "Ocean", colors: ["#0077b6", "#00a6c8", "#2ec4b6", "#1b998b", "#3a86ff", "#4f9de0", "#5e60ce"] },
  { id: "sunset", name: "Sunset", colors: ["#ff6b35", "#f7931e", "#e63946", "#e0a800", "#d62989", "#ff7a9c", "#9b5de5"] },
  { id: "forest", name: "Forest", colors: ["#2d6a4f", "#40916c", "#6a994e", "#a98e2b", "#4d7c8a", "#bc6c25", "#7f5539"] },
  { id: "neon", name: "Neon", colors: ["#ff00a8", "#00d5ff", "#2fe010", "#f5d800", "#b026ff", "#ff5f1f", "#00e88f"] },
  { id: "mono", name: "Mono", colors: ["#1f1f1f", "#3a3a3a", "#525252", "#6b6b6b", "#848484", "#9d9d9d", "#b5b5b5"] },
  { id: "candy", name: "Candy", colors: ["#ff6fae", "#3ccfd6", "#f5c400", "#a77bff", "#ff9f43", "#5fd068", "#ff6961"] },
];

export const DEFAULT_SCHEME = GRADIENT_SCHEMES[0];

/** Activity levels: 4 = worked on in the last 7 days ... 1 = older. */
export const ACTIVITY_LEVELS = [4, 3, 2, 1] as const;
/** How much of the area colour each level keeps (the rest is a neutral grey). */
const LEVEL_STRENGTH: Record<number, number> = { 4: 1, 3: 0.78, 2: 0.55, 1: 0.32 };
const NEUTRAL = 0x9a9a9a;

export function getScheme(id: string | undefined | null): GradientScheme {
  return GRADIENT_SCHEMES.find((s) => s.id === id) ?? DEFAULT_SCHEME;
}

export function hexToRgbInt(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return parseInt(h, 16);
}

export function rgbIntToHex(rgb: number): string {
  return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

/** Mix `rgb` with the neutral grey; strength 1 = the colour itself. */
export function shade(rgb: number, strength: number): number {
  const ch = (v: number, s: number) => (v >> s) & 255;
  const mix = (s: number) => Math.round(ch(NEUTRAL, s) + (ch(rgb, s) - ch(NEUTRAL, s)) * strength);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Colour of an area at an activity level (hex). */
export function areaLevelColor(scheme: GradientScheme, areaIndex: number, level: number): string {
  const base = hexToRgbInt(scheme.colors[areaIndex]) ?? NEUTRAL;
  return rgbIntToHex(shade(base, LEVEL_STRENGTH[level] ?? LEVEL_STRENGTH[2]));
}

export interface ColorGroupLike {
  query: string;
  color: { a: number; rgb: number };
}

/** Query prefix that marks the colour groups onboarding owns (so they can be replaced later). */
const AREA_QUERY = /^tag:#area\//i;

/**
 * graph.json colour groups for a scheme: per area, one group per activity level (strong to faint)
 * then a catch-all for notes with the area tag but no activity tag. The first matching group wins.
 */
export function areaColorGroups(scheme: GradientScheme): ColorGroupLike[] {
  const out: ColorGroupLike[] = [];
  AREAS.forEach((a, i) => {
    for (const level of ACTIVITY_LEVELS) out.push({ query: `tag:#area/${a.slug} tag:#activity/${level}`, color: { a: 1, rgb: hexToRgbInt(areaLevelColor(scheme, i, level))! } });
    out.push({ query: `tag:#area/${a.slug}`, color: { a: 1, rgb: hexToRgbInt(areaLevelColor(scheme, i, 2))! } });
  });
  return out;
}

/** Replace the area groups in an existing list, keeping the person's own groups first. */
export function mergeAreaColorGroups(existing: ColorGroupLike[] | undefined, scheme: GradientScheme): ColorGroupLike[] {
  const own = (existing ?? []).filter((g) => !AREA_QUERY.test(g?.query ?? ""));
  return [...own, ...areaColorGroups(scheme)];
}

// ---------- app colour presets and book themes ----------

export interface AppPreset {
  id: string;
  name: string;
  accent: string;
  /** appearance.json `theme`: system, moonstone (light) or obsidian (dark) */
  mode: "system" | "moonstone" | "obsidian";
}

export const APP_PRESETS: AppPreset[] = [
  { id: "amethyst", name: "Amethyst", accent: "#8a5cf5", mode: "system" },
  { id: "ocean", name: "Ocean", accent: "#2f7ddb", mode: "moonstone" },
  { id: "forest", name: "Forest", accent: "#2f9e63", mode: "obsidian" },
  { id: "rose", name: "Rose", accent: "#e0517a", mode: "moonstone" },
  { id: "ember", name: "Ember", accent: "#e8762d", mode: "obsidian" },
  { id: "graphite", name: "Graphite", accent: "#7c8796", mode: "obsidian" },
];

export const MODE_LABELS: Record<AppPreset["mode"], string> = { system: "Auto", moonstone: "Light", obsidian: "Dark" };

export type BookThemeId = "none" | "pixelated" | "minimal" | "animals" | "halloween" | "claude";

export const BOOK_THEMES: { id: BookThemeId; name: string; desc: string }[] = [
  { id: "none", name: "Classic", desc: "Bedrock as it is" },
  { id: "pixelated", name: "Pixelated", desc: "Pixel headings, crisp square edges" },
  { id: "minimal", name: "Minimal", desc: "Calm, quiet, lots of room" },
  { id: "animals", name: "Animals", desc: "Paw prints and warm colors" },
  { id: "halloween", name: "Halloween", desc: "Pumpkin orange and little bats" },
  { id: "claude", name: "Let Claude decide", desc: "Claude designs one just for you" },
];

// ---------- the instructions file ----------

export const INSTRUCTIONS_HEADER = `# Instructions for Claude

Bedrock writes requests here. Claude reads this file first, every time it works in this vault,
does every open request and checks it off.

- \`- [ ]\` is a request that still needs doing. When it's done, change it to \`- [x]\` and add
  "(done YYYY-MM-DD)". Don't delete requests.
- New requests go at the end of "Requests".
- "Preferences" are this person's choices. Keep every note consistent with them.
`;

export interface Preferences {
  scheme: GradientScheme;
  preset?: AppPreset | null;
  mode?: AppPreset["mode"];
  theme?: BookThemeId;
  date: string;
}

export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The area colour table used by the prompt and the Preferences section. */
export function areaColorLines(scheme: GradientScheme): string[] {
  return AREAS.map((a, i) => `| ${a.name} | area/${a.slug} | ${scheme.colors[i]} |`);
}

export function preferencesSection(p: Preferences): string {
  const theme = BOOK_THEMES.find((t) => t.id === (p.theme ?? "none"));
  const lines = [
    "## Preferences",
    "",
    `Chosen in Bedrock on ${p.date}.`,
    "",
    `- Graph colors: ${p.scheme.name}`,
  ];
  if (p.preset) lines.push(`- App colors: ${p.preset.name} (accent ${p.preset.accent}, ${MODE_LABELS[p.mode ?? p.preset.mode].toLowerCase()} mode)`);
  if (theme) lines.push(`- Book theme: ${theme.name}${theme.id === "claude" ? " (see the theme request below)" : ""}`);
  lines.push(
    "",
    "Area colors. Use these exact values for `color` in each note's properties:",
    "",
    "| Area | Tag | Color |",
    "|---|---|---|",
    ...areaColorLines(p.scheme),
    "",
    "Activity tags: `activity/4` = worked on in the last 7 days, `activity/3` = last 30 days,",
    "`activity/2` = last 90 days, `activity/1` = older. The graph shows each area from faint",
    "(activity/1) to strong (activity/4).",
    "",
  );
  return lines.join("\n");
}

interface Sections {
  head: string;
  sections: { heading: string; body: string }[];
}

function splitSections(text: string): Sections {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const head: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];
  for (const l of lines) {
    if (/^## /.test(l)) sections.push({ heading: l.slice(3).trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(l);
    else head.push(l);
  }
  return { head: head.join("\n"), sections: sections.map((s) => ({ heading: s.heading, body: s.body.join("\n") })) };
}

function joinSections(s: Sections): string {
  let out = s.head.replace(/\n+$/, "") + "\n";
  for (const sec of s.sections) out += `\n## ${sec.heading}\n${sec.body.replace(/^\n*/, "\n").replace(/\n+$/, "")}\n`;
  return out;
}

/** A fresh instructions file (header + empty Requests). */
export function newInstructionsFile(): string {
  return INSTRUCTIONS_HEADER + "\n## Requests\n\n";
}

function ensureShape(text: string | null | undefined): Sections {
  const s = splitSections(text && text.trim() ? text : newInstructionsFile());
  if (!s.head.trim()) s.head = INSTRUCTIONS_HEADER;
  if (!s.sections.some((x) => x.heading.toLowerCase() === "requests")) s.sections.push({ heading: "Requests", body: "" });
  return s;
}

/** Write (or replace) the Preferences section; it sits before Requests. */
export function setPreferences(text: string | null | undefined, p: Preferences): string {
  const s = ensureShape(text);
  const body = preferencesSection(p).split("\n").slice(1).join("\n");
  const i = s.sections.findIndex((x) => x.heading.toLowerCase() === "preferences");
  if (i >= 0) s.sections[i].body = body;
  else {
    const r = s.sections.findIndex((x) => x.heading.toLowerCase() === "requests");
    s.sections.splice(r, 0, { heading: "Preferences", body });
  }
  return joinSections(s);
}

/** Scheme name currently written in Preferences, if any. */
export function preferredSchemeName(text: string | null | undefined): string | null {
  const m = /^- Graph colors: (.+)$/m.exec(text ?? "");
  return m ? m[1].trim() : null;
}

/**
 * Add an open request (`- [ ] <title> (<date>): <body>`) at the end of Requests. A request with the
 * same title that is still open is replaced instead of added twice.
 */
export function addRequest(text: string | null | undefined, title: string, body: string, date = isoDate()): string {
  const s = ensureShape(text);
  const r = s.sections.find((x) => x.heading.toLowerCase() === "requests")!;
  const line = `- [ ] ${title} (${date}): ${body}`;
  const lines = r.body.split("\n");
  const open = lines.findIndex((l) => l.startsWith(`- [ ] ${title} (`));
  if (open >= 0) lines[open] = line;
  else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(line);
  }
  r.body = lines.join("\n");
  return joinSections(s);
}

/** Open requests (unchecked lines) in the file. */
export function openRequests(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).filter((l) => l.startsWith("- [ ] ")).map((l) => l.slice(6));
}

export const THEME_REQUEST_TITLE = "Theme request";
export const THEME_REQUEST_BODY =
  "design a personal Bedrock theme for this person based on what you know about them. Write it as a CSS snippet at `.obsidian/snippets/claude-theme.css` (use Obsidian's CSS variables such as --accent-h, --background-primary and --text-normal, and keep text easy to read in light and dark mode), turn it on by adding \"claude-theme\" to `enabledCssSnippets` in `.obsidian/appearance.json` (keep the other keys), and pick note icons and colors that match. Then mark this request done.";
export const RECOLOR_REQUEST_TITLE = "Colors changed";
export const RECOLOR_REQUEST_BODY = "the area colors in Preferences changed. Update the `color` property of every note to its area's new color. Then mark this request done.";

// ---------- the prompts ----------

function sepOf(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

/** Absolute path of the instructions file inside a vault. */
export function instructionsAbsPath(vaultPath: string): string {
  const sep = sepOf(vaultPath);
  return vaultPath.replace(/[\\/]+$/, "") + sep + INSTRUCTIONS_PATH.split("/").join(sep);
}

function defaultColorsLine(scheme: GradientScheme): string {
  return AREAS.map((a, i) => `${a.name} ${scheme.colors[i]}`).join(", ");
}

/** Prompt 1: build the personal wiki in this vault. */
export function buildWikiPrompt(vaultPath: string, scheme: GradientScheme = DEFAULT_SCHEME, today = isoDate()): string {
  const instr = instructionsAbsPath(vaultPath);
  const first = AREAS[0];
  return `Please build my personal wiki in Bedrock, my notes app. Bedrock is a folder of Markdown notes (it works like Obsidian) at:

${vaultPath}

Work only inside that folder. Be thorough: this should become a personal Wikipedia of all my projects and everything about me.

STEP 1. READ BEDROCK'S INSTRUCTIONS FIRST
Open "${instr}". Bedrock writes requests and my preferences there. Do every open request (lines starting with "- [ ]"), then mark each one done by changing it to "- [x]" and adding "(done YYYY-MM-DD)". Follow its Preferences in everything you write. Do this first every time you work in this vault. If the file doesn't exist yet, create it with a "## Requests" section.

STEP 2. LEARN ABOUT ME FROM EVERYTHING YOU CAN REACH
Use every source you have access to and skip the ones you don't:
- What you already know about me: your memory, CLAUDE.md and other instruction files, memory files, project notes.
- GitHub, with the gh CLI: my profile (gh api user), my repos (gh repo list --limit 200), each repo's README and languages, my recent commits, pull requests, issues and reviews (gh search commits --author=@me, gh search prs --author=@me, gh search issues --involves=@me).
- Project folders on this computer (Desktop, Documents, any code or projects folder): what each one is, its stack, and when it last changed (git log).
- Email, calendar, Google Drive, Slack and any other connectors you have: who I work with, what I'm working on, important dates.
- Notes already in this vault. Never delete or overwrite my own writing; add to it.
Never copy secrets into notes: no API keys, passwords, tokens, private keys, recovery codes, .env contents or card numbers. Keep private things (health, money) short and factual.

STEP 3. WRITE THE WIKI
Create these notes, one topic per note:
- Home.md: the front page. A short intro, then links to every section and to the most important notes.
- About me.md: who I am, what I do, where I'm based, skills, goals, tools I use, how I like to work.
- Projects/<project name>.md: one note per project. What it is, status (active, paused or done), stack, links (repo, website), people involved, a dated timeline of what happened, and what's next.
- People/<name>.md: people I work with or mention often, how we know each other, what we did together.
- Companies/<name>.md: companies, clients, schools and organisations in my life.
- Skills/<skill>.md: languages, tools and skills, linked to the projects that use them.
- Timeline.md: my life and work in date order, newest first, each line linking to the note it's about.
Use [[wikilinks]] generously. Every project links to its people, companies and skills, and those notes link back. Link a name every time it matters so the graph shows how everything connects. Link to an existing note instead of making a near-duplicate.

Start every note with properties like this:
---
area: ${first.name}
color: "${scheme.colors[0]}"
icon: 🚀
tags:
  - area/${first.slug}
  - activity/4
updated: ${today}
---
- area: the part of my life the note belongs to. Use one of: ${AREAS.map((a) => a.name).join(", ")}.
- color: that area's color from the Preferences in the instructions file. If there are none yet, use: ${defaultColorsLine(scheme)}. The same area always gets the same color.
- icon: one emoji that fits the note.
- tags: always "area/<area in lowercase>" and "activity/<1 to 4>", plus any topic tags you like.
- activity: 4 = worked on in the last 7 days, 3 = in the last 30 days, 2 = in the last 90 days, 1 = older. Base it on real dates (commits, file changes, emails).
- updated: the date you last changed the note.

STEP 4. GRAPH COLORS
Bedrock colors the graph by these tags, each area in its own color from faint (activity/1) to strong (activity/4), using the color groups in .obsidian/graph.json inside the vault. Bedrock sets those groups up from my chosen colors, so just tag every note correctly. Only if .obsidian/graph.json has no "tag:#area/..." groups at all, add them yourself: for each area and level a group like {"query": "tag:#area/${first.slug} tag:#activity/4", "color": {"a": 1, "rgb": <the color as a decimal number>}}, strongest color for level 4 and fading toward grey for 3, 2 and 1. Keep every other setting and group in that file.

HOW TO WRITE
If Bedrock's MCP tools are connected (the "bedrock" server: search, list_notes, create_note, edit_note, set_property), use them. Otherwise write the Markdown files straight into the folder above. Search before you create a note so there are no duplicates. Write in plain, clear words.

When you're done, tell me in a few lines what you made and which sources you couldn't reach.`;
}

/** Prompt 2: set up the daily update. */
export function buildDailyPrompt(vaultPath: string, time = "9 PM"): string {
  const instr = instructionsAbsPath(vaultPath);
  return `Please set up a daily job that keeps my Bedrock wiki up to date. Bedrock is my notes app: a folder of Markdown notes (it works like Obsidian) at:

${vaultPath}

1. CREATE THE SCHEDULE YOURSELF
Create a scheduled task named "Bedrock daily update" that runs once a day at ${time}, my local time. It has to run on this computer, because it reads my local files, so use a local scheduled task (for example the scheduled tasks feature in Claude desktop or Claude Code), not a cloud one. Use the job below, word for word, as the task's prompt.
If you can't create schedules here, tell me exactly how to set it up myself, for example a daily Task Scheduler (Windows) or cron (Mac) entry that runs: claude -p "<the job below>"
Then run the job once now so I can see it work.

2. THE DAILY JOB
"""
Update my Bedrock wiki at ${vaultPath} with today's activity.

a. First read "${instr}". Do every open request (lines starting with "- [ ]"), mark each one "- [x]" with "(done YYYY-MM-DD)", and follow its Preferences (area colors and activity tags).

b. Find everything I did today, from every source you can reach (skip the ones you can't):
- GitHub, with the gh CLI: my commits, pull requests, issues and reviews in every repo today (gh search commits --author=@me --committer-date=<today>, gh search prs --author=@me --updated=<today>, gh search issues --involves=@me --updated=<today>).
- Projects on this computer: repos and folders that changed today (git log --since=midnight in each repo) and what changed.
- Messages I sent (email, Slack and other connectors) and the most important emails I got.
- My calendar events today.
- Notable Claude sessions today: what was built, fixed or decided.

c. Write Daily/YYYY-MM-DD.md (today's date): a short summary at the top, then one section per area, every item on one line and linked to the [[project]], [[person]] or [[company]] note it's about. Give it properties: area (the main area of the day), color (that area's color), icon (one emoji for the day), tags (daily, area/<area>, activity/4) and updated.

d. Update the notes it touches: add a dated line to each project's timeline, update its status and "updated", and set its tag to activity/4. Lower the activity tag of notes nobody touched as they age: activity/3 after 7 days, activity/2 after 30 days, activity/1 after 90 days. Make notes for new projects, people or companies, link them from Home.md, and add today's highlights to Timeline.md. Use [[wikilinks]] and never make duplicates.

e. Never store secrets: no API keys, passwords, tokens, private keys or .env contents. Keep private details short.

f. Finish with a three-line summary of what changed.
"""`;
}
