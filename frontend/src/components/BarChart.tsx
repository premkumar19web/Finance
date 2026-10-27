import { formatMoney } from '../lib/format';

interface Point {
  label: string;
  collected: number;
  due: number;
}

/** Side-by-side bars of amount due vs amount collected per period. */
export function BarChart({ points }: { points: Point[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.collected, p.due]));
  return (
    <div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span className="l-due">Due</span>
        <span className="l-collected">Collected</span>
      </div>
      <div className="bar-chart" role="img" aria-label="Due versus collected chart">
        {points.map((p) => (
          <div key={p.label} className="bar-group"
            title={`${p.label}\nDue: ${formatMoney(p.due)}\nCollected: ${formatMoney(p.collected)}`}>
            <div className="bars">
              <div className="bar due" style={{ height: `${(p.due / max) * 100}%` }} />
              <div className="bar collected" style={{ height: `${(p.collected / max) * 100}%` }} />
            </div>
            <span className="bar-label">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
