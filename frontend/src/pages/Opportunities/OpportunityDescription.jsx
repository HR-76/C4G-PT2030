// Presentation only. The stored description is plain text with one block per line
// (the collector drops the source markup), so structure is inferred here and the
// text itself is never changed. Rendered as text nodes, never as HTML.
const BULLET = /^\s*(?:[•·▪◦‣*]|[-–—](?=\s))\s*/
const ends = (line, chars) => chars.includes(line.at(-1))
const sentence = line => ends(line, '.!?…') || line.length > 120
const NOTE = /^\[Excerto\b/

function headingLike(line, next) {
  if (!next || line.length > 80 || ends(line, '.,;:!?…') || line.split(/\s+/).length > 10) return false
  const first = line[0]
  return first !== first.toLowerCase() && sentence(next)
}

export function descriptionBlocks(text) {
  const lines = String(text || '').split('\n').map(line => line.trim())
  const blocks = []
  let listOpen = false // true while consecutive short lines follow a line ending in ":"
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], next = lines[index + 1], last = blocks.at(-1)
    if (!line) { listOpen = false; continue }
    if (NOTE.test(line)) { blocks.push({ type: 'note', text: line }); listOpen = false; continue }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '')
      if (last?.type === 'list' && last.marked) last.items.push(item)
      else blocks.push({ type: 'list', marked: true, items: [item] })
      listOpen = false
      continue
    }
    if (listOpen && !sentence(line)) {
      // A title-like line directly before running text closes the list ("Eligible Participants").
      if (last?.type === 'list' && !/\d/.test(line) && headingLike(line, next)) { blocks.push({ type: 'heading', text: line }); listOpen = false; continue }
      if (last?.type === 'list') last.items.push(line)
      else blocks.push({ type: 'list', items: [line] })
      continue
    }
    listOpen = ends(line, ':') && !!next && !sentence(next)
    blocks.push({ type: !listOpen && headingLike(line, next) ? 'heading' : 'paragraph', text: line })
  }
  return blocks
}

export default function OpportunityDescription({ id, text }) {
  return <div id={id} className="catalog-description opportunity-description">
    {descriptionBlocks(text).map((block, index) => block.type === 'list'
      ? <ul key={index}>{block.items.map((item, position) => <li key={position}>{item}</li>)}</ul>
      : block.type === 'heading' ? <h3 key={index}>{block.text}</h3>
        : <p key={index} className={block.type === 'note' ? 'opportunity-description-note' : undefined}>{block.text}</p>)}
  </div>
}
