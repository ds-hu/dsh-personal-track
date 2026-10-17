/**
 * The material Markdown parser.
 *
 * `src/client/board/markdown.ts` parses to data rather than to an HTML string —
 * which is what lets its rules be asserted here, in Node, with no DOM and no
 * renderer. The safety property that matters most is asserted too: a link whose
 * target is not plainly a web or mail address keeps its words and loses its
 * href, so a material can never become script execution.
 *
 * Runs on Node's native type stripping:
 *   node tests/markdown.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker } from './support.ts'
import { parseInline, parseMarkdown, type InlineRun, type MdBlock } from '../src/client/board/markdown.ts'

const { check, report } = createChecker('material markdown')

/** The runs of one block, for terse assertions. */
function runsOf(block: MdBlock | undefined): readonly InlineRun[] {
  if (block === undefined) return []
  return block.kind === 'heading' || block.kind === 'paragraph' ? block.runs : []
}

/** The text of one line's runs, joined. */
function textOf(runs: readonly InlineRun[]): string {
  return runs.map(run => run.text).join('')
}

// --- block structure ---------------------------------------------------------

check('a blank material yields no blocks', () => {
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('\n  \n'), [])
})

check('headings carry their level', () => {
  const blocks = parseMarkdown('# 一\n## 二\n### 三')
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'heading', 'heading'])
  assert.deepEqual(blocks.map(block => block.kind === 'heading' ? block.level : 0), [1, 2, 3])
  assert.equal(textOf(runsOf(blocks[0])), '一')
})

check('wrapped lines join into one paragraph, and a blank line splits', () => {
  const blocks = parseMarkdown('第一行\n第二行\n\n另一段')
  assert.deepEqual(blocks.map(block => block.kind), ['paragraph', 'paragraph'])
  assert.equal(textOf(runsOf(blocks[0])), '第一行 第二行')
  assert.equal(textOf(runsOf(blocks[1])), '另一段')
})

check('bullets and numbers become lists, in the order they appear', () => {
  const blocks = parseMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二')
  assert.deepEqual(blocks.map(block => block.kind), ['list', 'list'])
  const [first, second] = blocks
  assert.ok(first?.kind === 'list' && second?.kind === 'list')
  assert.equal(first.ordered, false)
  assert.deepEqual(first.items.map(textOf), ['甲', '乙'])
  assert.equal(second.ordered, true)
  assert.deepEqual(second.items.map(textOf), ['一', '二'])
})

check('a quote keeps its lines apart', () => {
  const blocks = parseMarkdown('> 第一句\n> 第二句')
  const quote = blocks[0]
  assert.ok(quote !== undefined && quote.kind === 'quote')
  assert.deepEqual(quote.lines.map(textOf), ['第一句', '第二句'])
})

check('a fenced block keeps its text verbatim', () => {
  const blocks = parseMarkdown('```\nrank A + dim N(A) = n\n**不解析**\n```')
  const code = blocks[0]
  assert.ok(code !== undefined && code.kind === 'code')
  assert.equal(code.text, 'rank A + dim N(A) = n\n**不解析**')
})

check('an unterminated fence still renders as code', () => {
  const blocks = parseMarkdown('```\n正在输入')
  assert.deepEqual(blocks.map(block => block.kind), ['code'])
})

// --- inline runs -------------------------------------------------------------

check('inline syntax is classified, and plain text stays plain', () => {
  const runs = parseInline('用 `P⁻¹` 左乘，**重点**，*轻*，还有文字')
  assert.deepEqual(runs.map(run => run.kind), ['text', 'code', 'text', 'strong', 'text', 'em', 'text'])
  assert.equal(runs[1]?.text, 'P⁻¹')
  assert.equal(runs[3]?.text, '重点')
  assert.equal(runs[5]?.text, '轻')
})

check('a web or mail link becomes a link', () => {
  const runs = parseInline('[讲义](https://example.com/a) 和 [信箱](mailto:a@b.c)')
  assert.equal(runs[0]?.kind, 'link')
  assert.equal(runs[0]?.kind === 'link' ? runs[0].href : '', 'https://example.com/a')
  assert.equal(runs[2]?.kind, 'link', 'mailto counts as safe')
})

check('an unsafe link target keeps the words and drops the link', () => {
  // No parentheses in the target: this parser's link grammar stops at one, and
  // that ceiling is asserted separately below.
  const runs = parseInline('[点我](javascript:alert)')
  assert.equal(runs.length, 1, 'nothing else is invented')
  assert.equal(runs[0]?.kind, 'text', 'the words survive as text')
  assert.equal(runs[0]?.text, '点我')
  assert.equal(
    JSON.stringify(runs).includes('javascript:'),
    false,
    'the target never reaches the output at all',
  )
})

check('an unmatched marker is literal text', () => {
  const runs = parseInline('2 * 3 * 4 和 未闭合 `code')
  assert.equal(textOf(runs), '2 * 3 * 4 和 未闭合 `code', 'no emphasis is invented around arithmetic')
  assert.deepEqual(runs.map(run => run.kind), ['text'], 'and the unclosed backtick stays literal')
})

check('a code span wins over emphasis inside it', () => {
  const runs = parseInline('`**粗**`')
  assert.deepEqual(runs.map(run => run.kind), ['code'])
  assert.equal(runs[0]?.text, '**粗**')
})

report()
