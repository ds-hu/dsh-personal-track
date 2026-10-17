/**
 * Render one parsed material.
 *
 * The component is deliberately thin: `parseMarkdown` owns the rules and this
 * maps its blocks to elements. Text arrives as React children rather than as
 * markup, so nothing a material contains can become HTML.
 */
import type { JSX, ReactNode } from 'react'
import { parseMarkdown, type InlineRun, type MdBlock } from './markdown.ts'

/** Render one inline run as an element. */
function runNode(run: InlineRun, key: number): ReactNode {
  switch (run.kind) {
    case 'text': return run.text
    case 'code': return <code key={key}>{run.text}</code>
    case 'strong': return <b key={key}>{run.text}</b>
    case 'em': return <i key={key}>{run.text}</i>
    case 'link': return <a key={key} href={run.href} target="_blank" rel="noreferrer">{run.text}</a>
  }
}

/** Render a list of runs. */
function runsOf(runs: readonly InlineRun[]): ReactNode[] {
  return runs.map((run, index) => runNode(run, index))
}

/** Render one block. */
function blockNode(block: MdBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const level = block.level + 2
      const children = runsOf(block.runs)
      if (level === 3) return <h3 key={key}>{children}</h3>
      if (level === 4) return <h4 key={key}>{children}</h4>
      return <h5 key={key}>{children}</h5>
    }
    case 'paragraph': return <p key={key}>{runsOf(block.runs)}</p>
    case 'code': return <pre key={key}><code>{block.text}</code></pre>
    case 'quote': return (
      <blockquote key={key}>
        {block.lines.map((line, index) => <p key={index}>{runsOf(line)}</p>)}
      </blockquote>
    )
    case 'list': return block.ordered
      ? <ol key={key}>{block.items.map((item, index) => <li key={index}>{runsOf(item)}</li>)}</ol>
      : <ul key={key}>{block.items.map((item, index) => <li key={index}>{runsOf(item)}</li>)}</ul>
  }
}

/** Render a material's Markdown. */
export function Markdown({ source }: { readonly source: string }): JSX.Element {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return <span className="pt-muted">（空文本块）</span>
  return <div className="pt-md">{blocks.map((block, index) => blockNode(block, index))}</div>
}
