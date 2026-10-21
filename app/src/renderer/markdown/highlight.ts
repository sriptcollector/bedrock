// Syntax highlighting for code blocks in reading view, using the same Lezer grammars as the editor.
// Output uses Prism-style class names (`token keyword`, `token string`...) because that is what
// community themes target in reading view.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";

export const prismLikeHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier], class: "token keyword" },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.docString], class: "token string" },
  { tag: [tags.regexp], class: "token regex" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: "token comment" },
  { tag: [tags.number, tags.integer, tags.float], class: "token number" },
  { tag: [tags.bool, tags.null, tags.atom], class: "token boolean" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "token function" },
  { tag: [tags.definition(tags.variableName)], class: "token variable" },
  { tag: [tags.className, tags.typeName, tags.namespace], class: "token class-name" },
  { tag: [tags.propertyName, tags.attributeName], class: "token property" },
  { tag: [tags.tagName], class: "token tag" },
  { tag: [tags.operator, tags.derefOperator, tags.arithmeticOperator, tags.logicOperator, tags.compareOperator], class: "token operator" },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.brace, tags.paren, tags.squareBracket, tags.angleBracket], class: "token punctuation" },
  { tag: [tags.meta, tags.processingInstruction], class: "token important" },
  { tag: [tags.heading], class: "token title important" },
  { tag: [tags.url, tags.link], class: "token url" },
  { tag: [tags.inserted], class: "token inserted" },
  { tag: [tags.deleted], class: "token deleted" },
  { tag: [tags.self, tags.special(tags.variableName)], class: "token builtin" },
]);

const cache = new Map<string, Promise<any>>();

export function findLanguage(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, true);
}

export async function highlightCodeInto(el: HTMLElement, code: string, lang: string): Promise<void> {
  const desc = findLanguage(lang);
  if (!desc) return;
  let p = cache.get(desc.name);
  if (!p) cache.set(desc.name, (p = desc.load()));
  let support: any;
  try {
    support = await p;
  } catch {
    return;
  }
  const tree = support.language.parser.parse(code);
  const frag = document.createDocumentFragment();
  highlightCode(
    code,
    tree,
    prismLikeHighlighter,
    (text, classes) => {
      if (classes) {
        const s = document.createElement("span");
        s.className = classes;
        s.textContent = text;
        frag.appendChild(s);
      } else frag.appendChild(document.createTextNode(text));
    },
    () => frag.appendChild(document.createTextNode("\n")),
  );
  el.empty();
  el.appendChild(frag);
}
