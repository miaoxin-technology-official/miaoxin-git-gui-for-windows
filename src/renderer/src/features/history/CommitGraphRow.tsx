import { GRAPH_WIDTH, laneX, type GraphRow } from './graph'
import '@/styles/graph.css'

function curve(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x1 - x2) < 0.01) return `M ${x1} ${y1} L ${x2} ${y2}`
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
}

function laneStroke(color: number): string {
  return `var(--graph-${(color % 8) + 1})`
}

export function CommitGraphRow({
  row,
  laneCount,
  rowHeight,
  isHead
}: {
  row: GraphRow
  laneCount: number
  rowHeight: number
  isHead: boolean
}): React.JSX.Element {
  const x = (lane: number): number => laneX(lane, laneCount)
  const cx = x(row.lane)
  const cy = rowHeight / 2
  const color = laneStroke(row.color)

  return (
    <svg
      className="graph-svg"
      width={GRAPH_WIDTH}
      height={rowHeight}
      viewBox={`0 0 ${GRAPH_WIDTH} ${rowHeight}`}
      aria-hidden="true"
      focusable="false"
    >
      {row.edges.map((edge, index) => (
        <path
          key={`lane-${index}`}
          className="graph-lane"
          d={curve(x(edge.fromLane), 0, x(edge.toLane), rowHeight)}
          style={{ stroke: laneStroke(edge.color) }}
        />
      ))}
      {row.incoming ? (
        <line className="graph-lane" x1={cx} y1={0} x2={cx} y2={cy} style={{ stroke: color }} />
      ) : null}
      {row.parents.map((parent, index) => (
        <path
          key={`parent-${index}`}
          className="graph-lane"
          d={curve(cx, cy, x(parent.lane), rowHeight)}
          style={{ stroke: laneStroke(parent.color) }}
        />
      ))}
      {isHead ? (
        <>
          <circle
            className="graph-node"
            cx={cx}
            cy={cy}
            r={4.4}
            fill="var(--bg-panel)"
            stroke="var(--accent)"
            strokeWidth={1.8}
          />
          <circle cx={cx} cy={cy} r={1.8} fill="var(--accent)" />
        </>
      ) : row.merge ? (
        <circle className="graph-node" cx={cx} cy={cy} r={4.3} fill={color} stroke="var(--bg-panel)" strokeWidth={1.6} />
      ) : (
        <circle cx={cx} cy={cy} r={3.3} fill={color} />
      )}
    </svg>
  )
}
