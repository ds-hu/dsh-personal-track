/**
 * A deliberately small Markdown parser for material text blocks.
 *
 * Same spirit as the board's hand-drawn SVG: enough to make an excerpt, a
 * formula list or a quoted paragraph readable, with no dependency at all — the
 * browser bundle may only require the frozen platform table (`react` and
 * `react/jsx-runtime`), so a real Markdown library is not an option.
 *
 * It parses to data rather than to an HTML string, which is what makes the two
 * properties worth having:
 *
 * - **Nothing is ever injected as markup.** Text arrives as runs and the
 *   component renders it as React children, so a material cannot smuggle HTML
 *   into the panel the way a string renderer plus `innerHTML` would allow.
 * - **The rules are testable in Node.** `parseMarkdown` takes a string and
 *   returns plain objects; the test layer asserts those, with no DOM.
 *
 * Supported, and deliberately no more: `#`/`##`/`###` headings, `-` and `1.`
 * lists, `>` quotes, ``` fences, and the flat inline set `code`, `**strong**`,
 * `*emphasis*`, `[text](https://link)`. Nesting is not attempted: a list inside
 * a quote is a paragraph, not a puzzle.
 */

/** One piece of inline text, already classified. */
export type InlineRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

/** One block of a material. */
export type MdBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'paragraph'; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly InlineRun[])[] }
  /** A quote keeps its lines apart, because a quote is often a citation. */
  | { readonly kind: 'quote'; readonly lines: readonly (readonly InlineRun[])[] }
  | { readonly kind: 'code'; readonly text: string }

/**
 * The inline tokens, in one alternation.
 *
 * Order matters: a code span must win over `*`, and `**` over `*`, so the regex
 * tries code first, then strong, then emphasis, then a link. Emphasis requires a
 * non-space first character — `2 * 3 * 4` is arithmetic, not emphasis, and the
 * rule that distinguishes them is the same one Markdown uses.
 *
 * A link target may not contain a space or a closing parenthesis. That is a
 * documented ceiling of this parser rather than an accident: the alternative is
 * a real link grammar, which is the dependency this module exists to avoid.
 */
const INLINE = /(`[^`]+`|\*\*[^*\s][^*]*\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g

/**
 * The link targets worth rendering.
 *
 * A material is the user's own text, but a `javascript:` href would still be
 * script execution disguised as a link, so anything that is not plainly a web
 * or mail address is left as literal text.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i

/** Classify one token from {@link INLINE}; anything else is plain text. */
function runOf(token: string): InlineRun {
  if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
    return { kind: 'code', text: token.slice(1, -1) }
  }
  if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
    return { kind: 'strong', text: token.slice(2, -2) }
  }
  if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
    return { kind: 'em', text: token.slice(1, -1) }
  }
  const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
  if (link !== null) {
    const [, text, href] = link
    // An unsafe target keeps the words and drops the link: silently deleting a
    // whole sentence because of its punctuation would be worse than not linking.
    return SAFE_HREF.test(href ?? '')
      ? { kind: 'link', text: text ?? '', href: href ?? '' }
      : { kind: 'text', text: text ?? '' }
  }
  return { kind: 'text', text: token }
}

/** Split one line into inline runs. */
export function parseInline(line: string): readonly InlineRun[] {
  const runs: InlineRun[] = []
  let cursor = 0
  for (const match of line.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > cursor) runs.push({ kind: 'text', text: line.slice(cursor, at) })
    runs.push(runOf(match[0]))
    cursor = at + match[0].length
  }
  if (cursor < line.length) runs.push({ kind: 'text', text: line.slice(cursor) })
  return runs.length === 0 ? [] : runs
}

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^[-•]\s+(.*)$/
const NUMBERED = /^\d+[.、]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/**
 * Parse one material into blocks.
 *
 * @param source - the material's text, as stored.
 * @returns its blocks; an empty (or blank) material yields none.
 */
export function parseMarkdown(source: string): readonly MdBlock[] {
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []
  let code: string[] | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    // A wrapped paragraph is one paragraph: its lines join with a space, the
    // way Markdown reads them.
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = (): void => {
    if (list === null) return
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    list = null
  }
  const flushQuote = (): void => {
    if (quote.length === 0) return
    blocks.push({ kind: 'quote', lines: quote.map(parseInline) })
    quote = []
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const line of source.split(/\r?\n/)) {
    if (code !== null) {
      if (line.trim() === '```') {
        blocks.push({ kind: 'code', text: code.join('\n') })
        code = null
      } else {
        code.push(line)
      }
      continue
    }
    if (line.trim() === '```') {
      flushAll()
      code = []
      continue
    }
    if (line.trim() === '') {
      flushAll()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flushAll()
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length as 1 | 2 | 3,
        runs: parseInline(heading[2] ?? ''),
      })
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted !== null) {
      flushParagraph()
      flushList()
      quote.push(quoted[1] ?? '')
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      flushParagraph()
      flushQuote()
      if (list === null || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1] ?? '')
      continue
    }

    const numbered = NUMBERED.exec(line)
    if (numbered !== null) {
      flushParagraph()
      flushQuote()
      if (list === null || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[1] ?? '')
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  }

  // An unterminated fence still renders as code: the user is mid-edit, and the
  // alternative is dropping text they can see themselves typing.
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') })
  flushAll()
  return blocks
}
