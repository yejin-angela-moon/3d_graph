import type { PaperNode } from '../types/graph'

export type GraphNodeOverlayProps = {
  paper: PaperNode
  onRead: (read: boolean) => void
  onNotes: (notes: string) => void
  onTitle: (title: string) => void
}

export function GraphNodeOverlay(props: GraphNodeOverlayProps) {
  const { paper, onRead, onNotes, onTitle } = props
  return (
    <div className="nodeOverlayCard">
      <input
        className="nodeOverlayTitleInput"
        type="text"
        value={paper.title ?? ''}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="Title"
      />
      <div className="nodeOverlayMeta mono">{paper.id}</div>
      {paper.arxivUrl ? (
        <div className="nodeOverlayRow">
          <a href={paper.arxivUrl} target="_blank" rel="noreferrer">
            {paper.arxivUrl}
          </a>
        </div>
      ) : null}
      {paper.doi ? (
        <div className="nodeOverlayRow">
          <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
            doi:{paper.doi}
          </a>
        </div>
      ) : null}
      <label className="nodeOverlayToggle">
        <input type="checkbox" checked={paper.read} onChange={(e) => onRead(e.target.checked)} />
        Read
      </label>
      <textarea
        className="nodeOverlayNotes"
        value={paper.notes}
        onChange={(e) => onNotes(e.target.value)}
        placeholder="Side notes…"
        rows={5}
      />
    </div>
  )
}
