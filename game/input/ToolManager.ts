/**
 * Tool state management (placeholder for MVP-1)
 */

import { Tool } from '../tools/Tool';
export { Tool };

export class ToolManager {
  private currentTool: Tool = Tool.SELECT;

  setTool(tool: Tool): void {
    this.currentTool = tool;
  }

  getCurrentTool(): Tool {
    return this.currentTool;
  }
}
