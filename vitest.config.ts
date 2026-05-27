import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['game/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Gate ONLY the pure-logic layer. Pixi render glue, DOM input
      // handlers, and the GameSession composition root are verified by
      // gameplay/manual testing, not brittle headless mocks — keeping
      // them out of the denominator keeps the % honest.
      include: [
        'game/core/buildingFootprint.ts',
        'game/core/zoneGrowth.ts',
        'game/core/Building.ts',
        'game/core/Demand.ts',
        'game/core/GameLoop.ts',
        'game/core/growthConstants.ts',
        'game/core/LandValueMap.ts',
        'game/core/Map.ts',
        'game/core/World.ts',
        'game/core/Tile.ts',
        'game/core/mapSerialization.ts',
        'game/tools/RoadTool.ts',
        'game/tools/BulldozeTool.ts',
        'game/tools/ToolActions.ts',
        'game/engine/CommandDispatcher.ts',
        'game/render/IsoTransform.ts',
        'game/render/cameraConstraints.ts',
        'game/render/viewportCulling.ts',
        'game/render/visuals/visualRegistry.ts',
        'game/render/visuals/polygon/cubeGeometry.ts',
        'game/render/visuals/polygon/cubeLift.ts',
        'game/render/visuals/polygon/cubeTypeRatios.ts',
        'game/render/visuals/polygon/cubeRoofAccent.ts',
        'game/render/visuals/polygon/cubeDropShadow.ts',
        'game/render/visuals/polygon/cubeBuildingZIndex.ts',
        'game/render/visuals/polygon/DiamondOOBSkirt.ts',
        'game/render/visuals/polygon/diamondShading.ts',
        'game/render/visuals/lighting.ts',
        'game/core/Terrain.ts',
        'game/core/terrainSlope.ts',
        'game/core/prng.ts',
        'game/core/valueNoise.ts',
        'game/core/heightShaping.ts',
        'game/core/waterMask.ts',
        'game/core/terrainGenerator.ts',
        'game/render/terrain/tileCornerHeights.ts',
        'game/render/terrain/terrainZIndex.ts',
        'game/render/visuals/polygon/buildingSeed.ts',
        'game/render/visuals/polygon/shellVariation.ts',
        'game/render/visuals/polygon/cubePalette.ts',
        'game/render/visuals/pixel/facadeComposer.ts',
        'game/render/visuals/pixel/facadeAtlasLayout.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
