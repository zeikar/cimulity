'use client';

/**
 * DataViewPanel: fixed overlay with None/Traffic/Jobs selector buttons and a
 * context-sensitive legend.
 *
 * Toggling the panel closed does NOT reset the view — panel visibility and
 * the active overlay are independent; only clicking a button changes the view.
 *
 * Legend colors are derived from the dataViewColors consts so the legend can
 * never drift from the actual ramp values used in the render overlay.
 */

import type { DataView } from '@/game/render/dataView';
import { RAMP_GREEN, RAMP_YELLOW, RAMP_RED, NO_DATA_COLOR } from '@/game/render/dataViewColors';

// Convert a packed 0xRRGGBB integer to a CSS hex string.
function toCssHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

const CSS_GREEN = toCssHex(RAMP_GREEN);
const CSS_YELLOW = toCssHex(RAMP_YELLOW);
const CSS_RED = toCssHex(RAMP_RED);
const CSS_NO_DATA = toCssHex(NO_DATA_COLOR);

interface DataViewPanelProps {
  active: DataView;
  onSelect: (v: DataView) => void;
}

const VIEWS: { value: DataView; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'jobs', label: 'Jobs' },
];

// Active/inactive button styles mirror the [Stats] button in GameHUD.
const activeStyle: React.CSSProperties = {
  backgroundColor: 'rgba(33, 150, 243, 0.8)',
  border: '2px solid rgba(33, 150, 243, 1)',
  color: 'white',
  padding: '6px 12px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '13px',
  borderRadius: '4px',
  width: '100%',
  textAlign: 'left',
};

const inactiveStyle: React.CSSProperties = {
  backgroundColor: 'rgba(60, 60, 60, 0.8)',
  border: '2px solid transparent',
  color: 'white',
  padding: '6px 12px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '13px',
  borderRadius: '4px',
  width: '100%',
  textAlign: 'left',
};

function SwatchRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
      <div
        style={{
          width: '14px',
          height: '14px',
          borderRadius: '2px',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}
      >
        {label}
      </span>
    </div>
  );
}

export function DataViewPanel({ active, onSelect }: DataViewPanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: '64px',
        // Offset left of StatsPanel (right:16px + 252px wide) so both panels
        // can be open at once without overlapping: 16 + 252 + 16px gap = 284px.
        right: '284px',
        width: '180px',
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
        DATA VIEW
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {VIEWS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onSelect(value)}
            style={active === value ? activeStyle : inactiveStyle}
          >
            {label}
          </button>
        ))}
      </div>

      {active === 'traffic' && (
        <div style={{ marginTop: '10px' }}>
          <div
            style={{
              height: '12px',
              borderRadius: '3px',
              // Three-stop ramp mirrors the actual congestionColor function stops.
              background: `linear-gradient(to right, ${CSS_GREEN}, ${CSS_YELLOW}, ${CSS_RED})`,
            }}
          />
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '10px',
              color: 'rgba(255,255,255,0.6)',
              marginTop: '3px',
            }}
          >
            Free → Jammed
          </div>
        </div>
      )}

      {active === 'jobs' && (
        <>
          <div style={{ marginTop: '10px' }}>
            <div
              style={{
                height: '12px',
                borderRadius: '3px',
                // Three-stop ramp mirrors the actual employmentColor function stops.
                background: `linear-gradient(to right, ${CSS_RED}, ${CSS_YELLOW}, ${CSS_GREEN})`,
              }}
            />
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.6)',
                marginTop: '3px',
              }}
            >
              Unemployed/Empty → Full
            </div>
          </div>
          <SwatchRow color={CSS_NO_DATA} label="No data" />
        </>
      )}
    </div>
  );
}
