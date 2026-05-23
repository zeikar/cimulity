/**
 * Tool categorization for UI organization and grouping
 */

import { Tool } from './Tool';

export enum ToolCategory {
  CURSOR = 'cursor',
  TERRAIN = 'terrain',
  BUILD = 'build',
  ZONE = 'zone',
  DEMOLISH = 'demolish',
}

/**
 * Maps each Tool to its ToolCategory
 * Pure data structure for grouping tools in the UI
 */
export const TOOL_CATEGORY: Record<Tool, ToolCategory> = {
  [Tool.SELECT]: ToolCategory.CURSOR,
  [Tool.TERRAIN_UP]: ToolCategory.TERRAIN,
  [Tool.TERRAIN_DOWN]: ToolCategory.TERRAIN,
  [Tool.ROAD]: ToolCategory.BUILD,
  [Tool.ZONE_RESIDENTIAL]: ToolCategory.ZONE,
  [Tool.ZONE_COMMERCIAL]: ToolCategory.ZONE,
  [Tool.ZONE_INDUSTRIAL]: ToolCategory.ZONE,
  [Tool.BULLDOZE]: ToolCategory.DEMOLISH,
};

/**
 * Stable category ordering for toolbar rendering
 * Ensures consistent UI layout across renders
 */
export const CATEGORY_ORDER = [
  ToolCategory.CURSOR,
  ToolCategory.TERRAIN,
  ToolCategory.BUILD,
  ToolCategory.ZONE,
  ToolCategory.DEMOLISH,
] as const;
