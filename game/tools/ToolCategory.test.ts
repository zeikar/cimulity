import { describe, it, expect } from 'vitest';
import { Tool } from './Tool';
import { ToolCategory, TOOL_CATEGORY, CATEGORY_ORDER } from './ToolCategory';

describe('ToolCategory', () => {
  describe('TOOL_CATEGORY mapping', () => {
    it('maps SELECT to CURSOR', () => {
      expect(TOOL_CATEGORY[Tool.SELECT]).toBe(ToolCategory.CURSOR);
    });

    it('maps TERRAIN_UP to TERRAIN', () => {
      expect(TOOL_CATEGORY[Tool.TERRAIN_UP]).toBe(ToolCategory.TERRAIN);
    });

    it('maps TERRAIN_DOWN to TERRAIN', () => {
      expect(TOOL_CATEGORY[Tool.TERRAIN_DOWN]).toBe(ToolCategory.TERRAIN);
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

    it('maps POWER_PLANT to POWER', () => {
      expect(TOOL_CATEGORY[Tool.POWER_PLANT]).toBe(ToolCategory.POWER);
    });

    it('maps WATER_TOWER to WATER', () => {
      expect(TOOL_CATEGORY[Tool.WATER_TOWER]).toBe(ToolCategory.WATER);
    });

    it('maps POLICE_STATION to POLICE', () => {
      expect(TOOL_CATEGORY[Tool.POLICE_STATION]).toBe(ToolCategory.POLICE);
    });

    it('maps FIRE_STATION to FIRE', () => {
      expect(TOOL_CATEGORY[Tool.FIRE_STATION]).toBe(ToolCategory.FIRE);
    });

    it('maps HOSPITAL to HOSPITAL', () => {
      expect(TOOL_CATEGORY[Tool.HOSPITAL]).toBe(ToolCategory.HOSPITAL);
    });

    it('maps SCHOOL to SCHOOL', () => {
      expect(TOOL_CATEGORY[Tool.SCHOOL]).toBe(ToolCategory.SCHOOL);
    });

    it('maps PARK to PARK', () => {
      expect(TOOL_CATEGORY[Tool.PARK]).toBe(ToolCategory.PARK);
    });
  });

  describe('CATEGORY_ORDER', () => {
    it('defines exact category order [CURSOR, TERRAIN, BUILD, ZONE, POWER, WATER, POLICE, FIRE, HOSPITAL, SCHOOL, PARK, DEMOLISH]', () => {
      expect(CATEGORY_ORDER).toEqual([
        ToolCategory.CURSOR,
        ToolCategory.TERRAIN,
        ToolCategory.BUILD,
        ToolCategory.ZONE,
        ToolCategory.POWER,
        ToolCategory.WATER,
        ToolCategory.POLICE,
        ToolCategory.FIRE,
        ToolCategory.HOSPITAL,
        ToolCategory.SCHOOL,
        ToolCategory.PARK,
        ToolCategory.DEMOLISH,
      ]);
    });

    it('has exactly 12 categories in order', () => {
      expect(CATEGORY_ORDER).toHaveLength(12);
    });

    it('SCHOOL appears after HOSPITAL in CATEGORY_ORDER', () => {
      const hospitalIdx = CATEGORY_ORDER.indexOf(ToolCategory.HOSPITAL);
      const schoolIdx = CATEGORY_ORDER.indexOf(ToolCategory.SCHOOL);
      expect(schoolIdx).toBeGreaterThan(hospitalIdx);
    });

    it('PARK appears after SCHOOL in CATEGORY_ORDER', () => {
      const schoolIdx = CATEGORY_ORDER.indexOf(ToolCategory.SCHOOL);
      const parkIdx = CATEGORY_ORDER.indexOf(ToolCategory.PARK);
      expect(parkIdx).toBeGreaterThan(schoolIdx);
    });
  });
});
