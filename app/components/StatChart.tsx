// StatChart: hand-rolled SVG sparkline for a single numeric series.
// WHY inline SVG instead of a chart library: zero additional deps; this is
// the only chart in the codebase and the design is deliberately minimal.

const W = 220;
const H = 56;

interface StatChartProps {
  label: string;
  color: string;
  values: number[];
  format?: (n: number) => string;
}

export function StatChart({ label, color, values, format }: StatChartProps) {
  const n = values.length;

  // Current-value display — guard n=0 so we never index values[-1] or call
  // format on undefined.
  const valueLabel =
    n === 0
      ? '—'
      : format != null
        ? format(values[n - 1])
        : String(values[n - 1]);

  // Build the polyline points string only when we have ≥2 points.
  // n<2: i/(n-1) is either NaN (n=1) or undefined (n=0), so skip the polyline.
  let pointsStr = '';
  if (n >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    // When all values are equal, max===min → division by zero → NaN.
    // Use mid-height (y=H/2) to render a visible flat line instead.
    const range = max - min;
    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const normalized = range === 0 ? 0.5 : (values[i] - min) / range;
      // y is inverted: higher normalized value → lower y (up on screen)
      const y = H - normalized * H;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    pointsStr = points.join(' ');
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'white', marginBottom: '6px' }}>
      <div style={{ marginBottom: '2px' }}>
        <span style={{ color }}>{label}</span>
        {': '}
        <span style={{ color }}>{valueLabel}</span>
      </div>
      <svg
        width={W}
        height={H}
        style={{ display: 'block', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}
      >
        {pointsStr && (
          <polyline
            points={pointsStr}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  );
}
