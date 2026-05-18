'use client';

/**
 * Toolbar component for tool selection
 */

import { Tool } from '@/game/tools';

export interface ToolbarProps {
  currentTool: Tool;
  onToolChange: (tool: Tool) => void;
}

interface ToolButton {
  tool: Tool;
  label: string;
  shortcut: string;
}

const TOOLS: ToolButton[] = [
  { tool: Tool.SELECT, label: 'Select', shortcut: 'S' },
  { tool: Tool.ROAD, label: 'Road', shortcut: 'R' },
  { tool: Tool.BULLDOZE, label: 'Bulldoze', shortcut: 'B' },
];

export function Toolbar({ currentTool, onToolChange }: ToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        display: 'flex',
        gap: '8px',
        padding: '12px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: '8px',
        zIndex: 1000,
      }}
    >
      {TOOLS.map(({ tool, label, shortcut }) => (
        <button
          key={tool}
          onClick={() => onToolChange(tool)}
          title={`${label} (${shortcut})`}
          style={{
            padding: '8px 16px',
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
          {label}
          <span style={{ opacity: 0.6, marginLeft: '8px', fontSize: '12px' }}>
            [{shortcut}]
          </span>
        </button>
      ))}
    </div>
  );
}
