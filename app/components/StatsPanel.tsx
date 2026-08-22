// StatsPanel: fixed-position overlay showing four sparkline charts.
// Rendered only when the [Stats] toggle is open, so it never blocks the canvas
// when closed. pointerEvents: 'auto' is set here (the HUD root is 'none').

import { StatChart } from './StatChart';
import type { StatsSample } from '@/app/hooks/sampleStats';

interface StatsPanelProps {
  samples: StatsSample[];
}

// Compact money formatter: rounds to integer with thousands separator.
function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function StatsPanel({ samples }: StatsPanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        // Placed below the "New City" button (fixed top:16px, ~37px tall → ~53px).
        // Bottom clearance of 120px ensures the panel stays above the Toolbar
        // (fixed bottom:16px, left:16px, which can grow tall on narrow viewports).
        top: '64px',
        right: '16px',
        bottom: '120px',
        width: '252px',
        overflowY: 'auto',
        padding: '12px',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        borderRadius: '6px',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: '10px',
          letterSpacing: '1px',
        }}
      >
        STATISTICS
      </div>
      <StatChart
        label="Population"
        color="#4caf50"
        values={samples.map((s) => s.population)}
        format={(n) => String(Math.round(n))}
      />
      <StatChart
        label="Balance"
        color="#2196f3"
        values={samples.map((s) => s.money)}
        format={formatMoney}
      />
      <StatChart
        label="Happiness"
        color="#ff9800"
        values={samples.map((s) => s.happiness)}
        format={(n) => n.toFixed(2)}
      />
      <StatChart
        label="Congestion"
        color="#f44336"
        values={samples.map((s) => s.congestion)}
        // Same 2-decimal [0, 1] notation as Happiness (not a percent) — congestion is the
        // exact value happiness subtracts via HAPPINESS_W_TRAFFIC, so matching notation lets
        // a reader compare magnitudes across the two charts. They do NOT share a drawn scale:
        // StatChart normalizes every series to its own min/max, so what aligns a congestion
        // spike with the happiness dip it caused is the shared X (time) axis, not the Y.
        format={(n) => n.toFixed(2)}
      />
    </div>
  );
}
