import { describe, it, expect } from 'vitest';
import { Tool } from './Tool';
import { ToolCategory, TOOL_CATEGORY, CATEGORY_ORDER } from './ToolCategory';

describe('ToolCategory', () => {
  describe('TOOL_CATEGORY mapping', () => {
    it('maps SELECT to CURSOR', () => {
      expect(TOOL_CATEGORY[Tool.SELECT]).toBe(ToolCategory.CURSOR);
    });

    it('maps PAINT_WATER to TERRAIN', () => {
      expect(TOOL_CATEGORY[Tool.PAINT_WATER]).toBe(ToolCategory.TERRAIN);
    });

    it('maps PAINT_GRASS to TERRAIN', () => {
      expect(TOOL_CATEGORY[Tool.PAINT_GRASS]).toBe(ToolCategory.TERRAIN);
    });

    it('maps ROAD to BUILD', () => {
      expect(TOOL_CATEGORY[Tool.ROAD]).toBe(ToolCategory.BUILD);
    });

    it('maps ZONE_RESIDENTIAL to ZONE', () => {
      expect(TOOL_CATEGORY[Tool.ZONE_RESIDENTIAL]).toBe(ToolCategory.ZONE);
    });

    it('maps ZONE_COMMERCIAL to ZONE', () => {
      expect(TOOL_CATEGORY[Tool.ZONE_COMMERCIAL]).toBe(ToolCategory.ZONE);
    });

    it('maps ZONE_INDUSTRIAL to ZONE', () => {
      expect(TOOL_CATEGORY[Tool.ZONE_INDUSTRIAL]).toBe(ToolCategory.ZONE);
    });

    it('maps BULLDOZE to DEMOLISH', () => {
      expect(TOOL_CATEGORY[Tool.BULLDOZE]).toBe(ToolCategory.DEMOLISH);
    });
  });

  describe('CATEGORY_ORDER', () => {
    it('defines exact category order [CURSOR, TERRAIN, BUILD, ZONE, DEMOLISH]', () => {
      expect(CATEGORY_ORDER).toEqual([
        ToolCategory.CURSOR,
        ToolCategory.TERRAIN,
        ToolCategory.BUILD,
        ToolCategory.ZONE,
        ToolCategory.DEMOLISH,
      ]);
    });

    it('has exactly 5 categories in order', () => {
      expect(CATEGORY_ORDER).toHaveLength(5);
    });
  });
});
