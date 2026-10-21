// Template variables (Templates, Daily notes, Unique note creator, Note composer):
//   {{title}} and any other named variable passed in, case-insensitive;
//   {{date}} {{time}} with the configured formats; {{date:FORMAT}} {{time:FORMAT}} with any moment
//   format. One moment value is used for the whole template.
import moment from "moment";

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT = "HH:mm";

export interface TemplateOptions {
  date?: moment.Moment;
  dateFormat?: string;
  timeFormat?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyTemplate(text: string, vars: Record<string, string>, opts: TemplateOptions = {}): string {
  const now = opts.date ?? moment();
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    if (/^(date|time)$/i.test(k)) continue;
    // Exact "{{name}}" (no inner spaces), case-insensitive — measured against Obsidian 1.14.4.
    out = out.replace(new RegExp(`{{${escapeRe(k)}}}`, "gi"), () => v);
  }
  // "{{date: dddd}}" keeps the leading space in the format, like the original.
  out = out.replace(/{{(date|time)(?::([^}]*))?}}/gi, (_m, kind: string, fmt?: string) => {
    const isDate = kind.toLowerCase() === "date";
    const f = fmt ? fmt : isDate ? opts.dateFormat || DEFAULT_DATE_FORMAT : opts.timeFormat || DEFAULT_TIME_FORMAT;
    return now.format(f);
  });
  return out;
}
