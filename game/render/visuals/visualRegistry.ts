import type { TileType } from '@/game/core/Tile';
import type { BuildingType } from '@/game/core/Building';
import type { TerrainTileVisual, BuildingVisual } from './TileVisual';

export class VisualRegistry {
  private terrainByType: Map<TileType, TerrainTileVisual> = new Map();
  private buildingByType: Map<BuildingType, BuildingVisual> = new Map();

  registerTerrain(type: TileType, visual: TerrainTileVisual): void {
    this.terrainByType.set(type, visual);
  }

  getTerrain(type: TileType): TerrainTileVisual {
    const visual = this.terrainByType.get(type);
    if (!visual) {
      throw new Error(`Visual not registered for terrain type: ${type}`);
    }
    return visual;
  }

  hasTerrain(type: TileType): boolean {
    return this.terrainByType.has(type);
  }

  registerBuilding(type: BuildingType, visual: BuildingVisual): void {
    this.buildingByType.set(type, visual);
  }

  getBuilding(type: BuildingType): BuildingVisual {
    const visual = this.buildingByType.get(type);
    if (!visual) {
      throw new Error(`Visual not registered for building type: ${type}`);
    }
    return visual;
  }

  hasBuilding(type: BuildingType): boolean {
    return this.buildingByType.has(type);
  }

  disposeAll(): void {
    for (const visual of this.terrainByType.values()) {
      visual.dispose?.();
    }
    for (const visual of this.buildingByType.values()) {
      visual.dispose?.();
    }
  }
}
