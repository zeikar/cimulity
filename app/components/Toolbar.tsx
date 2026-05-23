'use client';

/**
 * Toolbar component for tool selection
 */

import { Tool, ToolCategory, TOOL_CATEGORY, CATEGORY_ORDER } from '@/game/tools';

export interface ToolbarProps {
  currentTool: Tool;
  onToolChange: (tool: Tool) => void;
  paused: boolean;
  speedMultiplier: 1 | 2 | 3;
  onPauseToggle: () => void;
  onSpeedChange: (tier: 1 | 2 | 3) => void;
}

interface ToolButton {
  tool: Tool;
  label: string;
  shortcut: string;
}

const SPEEDS: { value: 1 | 2 | 3; label: string; shortcut: string }[] = [
  { value: 1, label: '1x', shortcut: '1' },
  { value: 2, label: '2x', shortcut: '2' },
  { value: 3, label: '3x', shortcut: '3' },
];

const TOOL_BUTTONS: Record<Tool, ToolButton> = {
  [Tool.SELECT]: { tool: Tool.SELECT, label: 'Select', shortcut: 'S' },
  [Tool.ROAD]: { tool: Tool.ROAD, label: 'Road', shortcut: 'T' },
  [Tool.BULLDOZE]: { tool: Tool.BULLDOZE, label: 'Bulldoze', shortcut: 'B' },
  [Tool.ZONE_RESIDENTIAL]: { tool: Tool.ZONE_RESIDENTIAL, label: 'Residential', shortcut: 'Q' },
  [Tool.ZONE_COMMERCIAL]: { tool: Tool.ZONE_COMMERCIAL, label: 'Commercial', shortcut: 'W' },
  [Tool.ZONE_INDUSTRIAL]: { tool: Tool.ZONE_INDUSTRIAL, label: 'Industrial', shortcut: 'E' },
  [Tool.PAINT_WATER]: { tool: Tool.PAINT_WATER, label: 'Paint Water', shortcut: 'Shift+W' },
  [Tool.PAINT_GRASS]: { tool: Tool.PAINT_GRASS, label: 'Paint Grass', shortcut: 'Shift+G' },
  [Tool.TERRAIN_UP]: { tool: Tool.TERRAIN_UP, label: 'Raise', shortcut: 'R' },
  [Tool.TERRAIN_DOWN]: { tool: Tool.TERRAIN_DOWN, label: 'Lower', shortcut: 'F' },
};

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  [ToolCategory.CURSOR]: 'Cursor',
  [ToolCategory.TERRAIN]: 'Terrain',
  [ToolCategory.BUILD]: 'Build',
  [ToolCategory.ZONE]: 'Zone',
  [ToolCategory.DEMOLISH]: 'Demolish',
};

const TOOL_GROUPS = CATEGORY_ORDER.map(cat => ({
  category: cat,
  label: CATEGORY_LABELS[cat],
  tools: (Object.values(Tool) as Tool[]).filter(t => TOOL_CATEGORY[t] === cat).map(t => TOOL_BUTTONS[t]),
}));

export function Toolbar({ currentTool, onToolChange, paused, speedMultiplier, onPauseToggle, onSpeedChange }: ToolbarProps) {
  function renderGroup({ label, tools }: { label: string; tools: ToolButton[] }) {
    return (
      <div key={label} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {tools.map(({ tool, label: btnLabel, shortcut }) => (
          <button
            key={tool}
            onClick={() => onToolChange(tool)}
            title={`${btnLabel} (${shortcut})`}
            style={{
              padding: '6px 12px',
              backgroundColor: currentTool === tool ? 'rgba(74, 158, 61, 0.8)' : 'rgba(60, 60, 60, 0.8)',
              color: 'white',
              border: currentTool === tool ? '2px solid rgba(74, 158, 61, 1)' : '2px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: currentTool === tool ? 'bold' : 'normal',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (currentTool !== tool) {
                e.currentTarget.style.backgroundColor = 'rgba(80, 80, 80, 0.8)';
              }
            }}
            onMouseLeave={(e) => {
              if (currentTool !== tool) {
                e.currentTarget.style.backgroundColor = 'rgba(60, 60, 60, 0.8)';
              }
            }}
          >
            {btnLabel}
            <span style={{ opacity: 0.6, marginLeft: '8px', fontSize: '12px' }}>
              [{shortcut}]
            </span>
          </button>
        ))}
        <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'stretch' }} />
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 'calc(100vw - 32px)',
        gap: '8px',
        padding: '12px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: '8px',
        zIndex: 1000,
      }}
    >
      {/* Row 1: Tool groups */}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        {TOOL_GROUPS.map(group => renderGroup(group))}
      </div>
      {/* Row 2: Time controls */}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          Time
        </span>
        <button
          onClick={onPauseToggle}
          title={paused ? 'Play (Space)' : 'Pause (Space)'}
          style={{
            padding: '6px 12px',
            backgroundColor: paused ? 'rgba(74, 158, 61, 0.8)' : 'rgba(60, 60, 60, 0.8)',
            color: 'white',
            border: paused ? '2px solid rgba(74, 158, 61, 1)' : '2px solid transparent',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '14px',
            fontWeight: paused ? 'bold' : 'normal',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (!paused) {
              e.currentTarget.style.backgroundColor = 'rgba(80, 80, 80, 0.8)';
            }
          }}
          onMouseLeave={(e) => {
            if (!paused) {
              e.currentTarget.style.backgroundColor = 'rgba(60, 60, 60, 0.8)';
            }
          }}
        >
          {paused ? 'Play' : 'Pause'}
          <span style={{ opacity: 0.6, marginLeft: '8px', fontSize: '12px' }}>
            [Space]
          </span>
        </button>
        {SPEEDS.map(({ value, label, shortcut }) => (
          <button
            key={value}
            onClick={() => onSpeedChange(value)}
            title={`${label} (${shortcut})`}
            style={{
              padding: '6px 12px',
              backgroundColor: speedMultiplier === value ? 'rgba(74, 158, 61, 0.8)' : 'rgba(60, 60, 60, 0.8)',
              color: 'white',
              border: speedMultiplier === value ? '2px solid rgba(74, 158, 61, 1)' : '2px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: speedMultiplier === value ? 'bold' : 'normal',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (speedMultiplier !== value) {
                e.currentTarget.style.backgroundColor = 'rgba(80, 80, 80, 0.8)';
              }
            }}
            onMouseLeave={(e) => {
              if (speedMultiplier !== value) {
                e.currentTarget.style.backgroundColor = 'rgba(60, 60, 60, 0.8)';
              }
            }}
          >
            {label}
            <span style={{ opacity: 0.6, marginLeft: '8px', fontSize: '12px' }}>
              [{shortcut}]
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
