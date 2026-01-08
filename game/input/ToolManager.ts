/**
 * Tool state management (placeholder for MVP-1)
 */

export enum Tool {
  SELECT = 'select',
  BULLDOZE = 'bulldoze',
  ZONE_RESIDENTIAL = 'zone_residential',
  // More tools in MVP-1
}

export class ToolManager {
  private currentTool: Tool = Tool.SELECT;

  setTool(tool: Tool): void {
    this.currentTool = tool;
  }

  getCurrentTool(): Tool {
    return this.currentTool;
  }
}
