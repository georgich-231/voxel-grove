import {
  ATLAS_CELL_SIZE,
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  ATLAS_TILE_PADDING,
  ATLAS_TILE_SIZE,
  BLOCK_TEXTURE_KEYS,
} from "./atlasKeys.js";
import {
  BIRCH_FOLIAGE_COLOR,
  SPRUCE_FOLIAGE_COLOR,
} from "./biomeColors.js";
import {
  EXTRA_BLOCK_DEFINITIONS,
  EXTRA_BLOCK_DEFINITION_BY_BLOCK,
  RUNTIME_BLOCK_DEFINITIONS,
  getExtraBlockFaceTexture,
} from "./creativeContent.js";
import { getBlockShapeById } from "./blockShapes.js";

const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 320;
const WATER_MAX_DEPTH = 7;
const WATER_DEPTH_VISIBILITY_LIMIT = 18;
const WATER_LEVEL_STORE_MASK = 0x0f;
const WATER_FALLING_STORE_FLAG = 0x10;
const PADDED_SIZE = CHUNK_SIZE + 2;
const PADDED_AREA = PADDED_SIZE * PADDED_SIZE;
const MAX_LIGHT_LEVEL = 15;
const MIN_LIGHT_FACTOR = 0.03;
const MAX_BLOCK_LIGHT_FACTOR = 2.05;
const DEFAULT_WATER_TINT = 0x3f76e4;
const SHALLOW_WATER_TINT = 0x73d8ff;
const DEEP_WATER_TINT = 0x0f337f;
const UNDERWATER_WATER_TINT = 0x1e4f9f;
const WATER_DEPTH_ALPHA_MIN = 0.34;
const WATER_DEPTH_ALPHA_MAX = 0.62;
const WATER_SKY_LIGHT_LOSS_MIN = 7;
const WATER_SKY_LIGHT_LOSS_MAX = 14;

const Block = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANK: 7,
  CLAY: 8,
  BEDROCK: 9,
  CRAFTING_TABLE: 10,
  PODZOL: 11,
  JUNGLE_GRASS: 12,
  MUD: 13,
  SANDSTONE: 14,
  SPRUCE_LOG: 15,
  SPRUCE_LEAVES: 16,
  JUNGLE_LOG: 17,
  JUNGLE_LEAVES: 18,
  CACTUS: 19,
  WATER: 20,
  GRAVEL: 21,
  COBBLESTONE: 22,
  COAL_ORE: 23,
  IRON_ORE: 24,
  COPPER_ORE: 25,
  GOLD_ORE: 26,
  DIAMOND_ORE: 27,
  RED_SAND: 28,
  TERRACOTTA: 29,
  WHITE_TERRACOTTA: 30,
  SNOW_GRASS: 31,
  SNOW: 32,
  BIRCH_LOG: 33,
  BIRCH_LEAVES: 34,
  MOSS: 35,
  WILDFLOWER: 36,
  FERN: 37,
  MEADOW_GRASS: 38,
  DRY_GRASS: 39,
  ACACIA_LOG: 40,
  ACACIA_LEAVES: 41,
  LIMESTONE: 42,
  BASALT: 43,
  SLATE: 44,
  TALL_GRASS: 45,
  GRANITE: 46,
  DIORITE: 47,
  ANDESITE: 48,
  DEEPSLATE: 49,
  ICE: 50,
  PACKED_ICE: 51,
  DANDELION: 52,
  POPPY: 53,
  BLUE_ORCHID: 54,
  DEAD_BUSH: 55,
  BERRY_BUSH: 56,
  SUGAR_CANE: 57,
  PUMPKIN: 58,
  MELON: 59,
  VINE: 60,
  COARSE_DIRT: 61,
  SAVANNA_GRASS: 62,
  CLOVER: 63,
  SAVANNA_SHRUB: 64,
  DARK_OAK_LOG: 65,
  DARK_OAK_LEAVES: 66,
  MYCELIUM: 67,
  BROWN_MUSHROOM: 68,
  RED_MUSHROOM: 69,
  SUNFLOWER: 70,
  WATERLILY: 71,
};

for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  Block[definition.constant] = definition.block;
}

const BLOCK_MASK_SIZE = Math.max(...Object.values(Block)) + 1;
const SOLID_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[
  Block.GRASS,
  Block.DIRT,
  Block.STONE,
  Block.SAND,
  Block.LOG,
  Block.LEAVES,
  Block.PLANK,
  Block.CLAY,
  Block.BEDROCK,
  Block.CRAFTING_TABLE,
  Block.PODZOL,
  Block.JUNGLE_GRASS,
  Block.MUD,
  Block.SANDSTONE,
  Block.SPRUCE_LOG,
  Block.SPRUCE_LEAVES,
  Block.JUNGLE_LOG,
  Block.JUNGLE_LEAVES,
  Block.CACTUS,
  Block.GRAVEL,
  Block.COBBLESTONE,
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.COPPER_ORE,
  Block.GOLD_ORE,
  Block.DIAMOND_ORE,
  Block.RED_SAND,
  Block.TERRACOTTA,
  Block.WHITE_TERRACOTTA,
  Block.SNOW_GRASS,
  Block.SNOW,
  Block.BIRCH_LOG,
  Block.BIRCH_LEAVES,
  Block.MOSS,
  Block.MEADOW_GRASS,
  Block.DRY_GRASS,
  Block.ACACIA_LOG,
  Block.ACACIA_LEAVES,
  Block.LIMESTONE,
  Block.BASALT,
  Block.SLATE,
  Block.GRANITE,
  Block.DIORITE,
  Block.ANDESITE,
  Block.DEEPSLATE,
  Block.ICE,
  Block.PACKED_ICE,
  Block.PUMPKIN,
  Block.MELON,
  Block.COARSE_DIRT,
  Block.SAVANNA_GRASS,
  Block.DARK_OAK_LOG,
  Block.DARK_OAK_LEAVES,
  Block.MYCELIUM,
].forEach((block) => {
  SOLID_MASK[block] = 1;
});
for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  if (definition.solid) SOLID_MASK[definition.block] = 1;
}

const PLANT_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[
  Block.WILDFLOWER,
  Block.FERN,
  Block.TALL_GRASS,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.DEAD_BUSH,
  Block.BERRY_BUSH,
  Block.SUGAR_CANE,
  Block.VINE,
  Block.CLOVER,
  Block.SAVANNA_SHRUB,
  Block.BROWN_MUSHROOM,
  Block.RED_MUSHROOM,
  Block.SUNFLOWER,
  Block.WATERLILY,
].forEach((block) => {
  PLANT_MASK[block] = 1;
});
for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  if (definition.plant) PLANT_MASK[definition.block] = 1;
}

const LEAF_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[
  Block.LEAVES,
  Block.SPRUCE_LEAVES,
  Block.JUNGLE_LEAVES,
  Block.BIRCH_LEAVES,
  Block.ACACIA_LEAVES,
  Block.DARK_OAK_LEAVES,
].forEach((block) => {
  LEAF_MASK[block] = 1;
});
for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  if (definition.leaf) LEAF_MASK[definition.block] = 1;
}

const GRASS_TINT_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[
  Block.GRASS,
  Block.JUNGLE_GRASS,
  Block.MEADOW_GRASS,
  Block.DRY_GRASS,
  Block.SAVANNA_GRASS,
].forEach((block) => {
  GRASS_TINT_MASK[block] = 1;
});

const GRASS_TINT_PLANT_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[
  Block.FERN,
  Block.TALL_GRASS,
  Block.SUGAR_CANE,
  Block.CLOVER,
].forEach((block) => {
  GRASS_TINT_PLANT_MASK[block] = 1;
});

const FOLIAGE_TINT_PLANT_MASK = new Uint8Array(BLOCK_MASK_SIZE);
[Block.VINE, Block.WATERLILY].forEach((block) => {
  FOLIAGE_TINT_PLANT_MASK[block] = 1;
});

const FULL_BLOCK_BOUNDS = Object.freeze({
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
});
const CACTUS_BLOCK_BOUNDS = Object.freeze({
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
});

const VINE_FACE_DEFS = Object.freeze([
  {
    support: [-1, 0],
    normal: [1, 0, 0],
    vertices: [
      [0.032, 0, 1],
      [0.032, 1, 1],
      [0.032, 1, 0],
      [0.032, 0, 0],
    ],
  },
  {
    support: [1, 0],
    normal: [-1, 0, 0],
    vertices: [
      [0.968, 0, 0],
      [0.968, 1, 0],
      [0.968, 1, 1],
      [0.968, 0, 1],
    ],
  },
  {
    support: [0, -1],
    normal: [0, 0, 1],
    vertices: [
      [0, 0, 0.032],
      [0, 1, 0.032],
      [1, 1, 0.032],
      [1, 0, 0.032],
    ],
  },
  {
    support: [0, 1],
    normal: [0, 0, -1],
    vertices: [
      [1, 0, 0.968],
      [1, 1, 0.968],
      [0, 1, 0.968],
      [0, 0, 0.968],
    ],
  },
]);

const FACE_DEFS = [
  {
    name: "px",
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    shade: 0.60,
  },
  {
    name: "nx",
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    shade: 0.60,
  },
  {
    name: "py",
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 1,
  },
  {
    name: "ny",
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.50,
  },
  {
    name: "pz",
    dir: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
    shade: 0.80,
  },
  {
    name: "nz",
    dir: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    shade: 0.80,
  },
];

const ATLAS_REGIONS = createAtlasRegions();
let smoothLightingEnabled = true;
let fullBrightLightingEnabled = false;

self.onmessage = (event) => {
  try {
    const data = event.data;
    smoothLightingEnabled = data.smoothLighting !== false;
    fullBrightLightingEnabled = data.fullBrightLighting === true;
    const result = buildChunkMesh(data);
    const transfer = [];
    const seenBuffers = new Set();

    for (const mesh of [result.solid, result.leaf, result.torch, result.water, result.lava]) {
      for (const attribute of ["positions", "normals", "colors", "uvs", "waves", "indices"]) {
        const buffer = mesh[attribute].buffer;
        if (buffer.byteLength > 0 && !seenBuffers.has(buffer)) {
          seenBuffers.add(buffer);
          transfer.push(buffer);
        }
      }
    }

    self.postMessage({ id: data.id, solid: result.solid, leaf: result.leaf, torch: result.torch, water: result.water, lava: result.lava }, transfer);
  } catch (error) {
    self.postMessage({ id: event.data?.id, error: error?.stack || String(error) });
  }
};

function buildChunkMesh(data) {
  const world = createSnapshotWorld(data);
  const solidBuffers = createMeshBuffers();
  const leafBuffers = createMeshBuffers();
  const torchBuffers = createMeshBuffers();
  const waterBuffers = createMeshBuffers();
  const lavaBuffers = createMeshBuffers();
  const worldX0 = data.cx * CHUNK_SIZE;
  const worldZ0 = data.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      const wx = worldX0 + x;
      const wz = worldZ0 + z;
      const topY = world.columnTopY
        ? world.columnTopY[(z + 1) * PADDED_SIZE + (x + 1)]
        : getSnapshotColumnTopY(world, x, z);
      let startY = 0;
      let fastLiquidSurfaceY = -1;
      let fastLiquidFloorY = -1;
      if (data.heightmapOnly && world.columnTopY) {
        const topBlock = getSnapshotBlock(world, x, topY, z);
        const surfaceY = getSnapshotHeightmapSurfaceY(world, x, z, topY);
        let lowestNeighborSurfaceY = surfaceY >= 0 ? surfaceY : topY;
        if (isLiquid(topBlock)) {
          fastLiquidSurfaceY = topY;
          fastLiquidFloorY = surfaceY;
        }

        if (getSnapshotGeneratedColumn(world, x + 1, z)) {
          const neighborSurfaceY = getSnapshotHeightmapSurfaceY(world, x + 1, z);
          lowestNeighborSurfaceY = Math.min(lowestNeighborSurfaceY, neighborSurfaceY >= 0 ? neighborSurfaceY : lowestNeighborSurfaceY);
        }
        if (getSnapshotGeneratedColumn(world, x - 1, z)) {
          const neighborSurfaceY = getSnapshotHeightmapSurfaceY(world, x - 1, z);
          lowestNeighborSurfaceY = Math.min(lowestNeighborSurfaceY, neighborSurfaceY >= 0 ? neighborSurfaceY : lowestNeighborSurfaceY);
        }
        if (getSnapshotGeneratedColumn(world, x, z + 1)) {
          const neighborSurfaceY = getSnapshotHeightmapSurfaceY(world, x, z + 1);
          lowestNeighborSurfaceY = Math.min(lowestNeighborSurfaceY, neighborSurfaceY >= 0 ? neighborSurfaceY : lowestNeighborSurfaceY);
        }
        if (getSnapshotGeneratedColumn(world, x, z - 1)) {
          const neighborSurfaceY = getSnapshotHeightmapSurfaceY(world, x, z - 1);
          lowestNeighborSurfaceY = Math.min(lowestNeighborSurfaceY, neighborSurfaceY >= 0 ? neighborSurfaceY : lowestNeighborSurfaceY);
        }

        startY = Math.max(0, lowestNeighborSurfaceY - 1);
      }
      for (let y = startY; y <= topY; y += 1) {
        if (fastLiquidSurfaceY >= 0 && y > fastLiquidFloorY && y < fastLiquidSurfaceY) continue;
        const block = getSnapshotBlock(world, x, y, z);

        if (block === Block.VINE) {
          pushVine(solidBuffers, world, wx, y, wz, block);
          continue;
        }

        if (isPlant(block)) {
          pushPlant(solidBuffers, world, wx, y, wz, block);
          continue;
        }

        const customShape = getBlockShapeForBlock(block);
        if (customShape) {
          const targetBuffers = isTorchCustomShapeBlock(block) ? torchBuffers : solidBuffers;
          pushCustomShape(targetBuffers, world, wx, y, wz, block, customShape);
          continue;
        }

        if (!isSolid(block) && !isLiquid(block)) continue;

        for (const face of FACE_DEFS) {
          const nx = wx + face.dir[0];
          const ny = y + face.dir[1];
          const nz = wz + face.dir[2];
          const neighbor = world.getBlock(nx, ny, nz);

          if (isLiquid(block)) {
            const sameLiquidNeighbor = isSameLiquid(neighbor, block);
            const neighborColumnReady = world.hasGeneratedColumn(nx, nz);
            const renderFallingTopCap = face.name === "py" && shouldRenderFallingLiquidTopCap(world, wx, y, wz, block);
            if (face.dir[1] === 0 && !neighborColumnReady) continue;
            if (sameLiquidNeighbor && !renderFallingTopCap) continue;
            if (!sameLiquidNeighbor && isFaceOccluding(neighbor)) continue;
            if (face.name === "py" && isFallingLiquidBlock(world, wx, y, wz, block) && !renderFallingTopCap) continue;
            const waterBlock = isWater(block);
            const variation = waterBlock
              ? 1
              : 0.92 + hashFloat(wx + face.dir[0] * 5, wz + face.dir[2] * 5, y + world.seed) * 0.08;
            const liquidBuffers = isLava(block) ? lavaBuffers : waterBuffers;
            const waterDepth = waterBlock ? getWaterColumnDepth(world, wx, y, wz) : 0;
            pushVoxelFace(liquidBuffers, world, wx, y, wz, block, face, {
              topHeights: getLiquidFaceTopHeights(world, wx, y, wz, block, face),
              variation,
              ao: !waterBlock,
              waveTop: true,
              fullTileUv: true,
              tintColor: waterBlock ? world.getWaterColor(wx, wz) : getLiquidTintColor(world, wx, wz, block),
              waterDepth,
              colorAlpha: waterBlock ? getWaterDepthAlpha(waterDepth) : null,
              lightLevel: isLava(block) ? MAX_LIGHT_LEVEL : undefined,
            });
            continue;
          }

          const leafBlock = isLeafBlock(block);
          const neighborLeaf = leafBlock && isLeafBlock(neighbor);
          const neighborIsLeaf = isLeafBlock(neighbor);
          if (isFaceOccluding(neighbor)) {
            if (leafBlock) {
              // Leaf block: cull unless it's a shared leaf-to-leaf boundary
              if (!neighborLeaf || !shouldRenderSharedLeafFace(face)) continue;
            } else if (!neighborIsLeaf) {
              // Solid block with a solid opaque neighbor: cull
              continue;
            }
            // Solid block with a leaf neighbor: don't cull — the solid face should
            // be visible through the leaf block's transparent texture gaps.
          }
          const variation = 0.9 + hashFloat(wx + face.dir[0] * 7, wz + face.dir[2] * 7, y + world.seed) * 0.16;
          const targetBuffers = leafBlock ? leafBuffers : solidBuffers;
          const submergedDepth = neighbor === Block.WATER ? getWaterDepthAbove(world, nx, ny, nz) : 0;
          pushVoxelFace(targetBuffers, world, wx, y, wz, block, face, {
            variation,
            ao: true,
            submergedDepth,
            waterTintColor: submergedDepth > 0 ? world.getWaterColor(nx, nz) : null,
          });
          if (hasGrassSideOverlay(block, face.name)) {
            pushVoxelFace(targetBuffers, world, wx, y, wz, block, face, {
              variation,
              ao: true,
              textureKey: "grass_side_overlay",
              tintColor: world.getGrassColor(wx, wz),
              positionOffset: 0.0015,
              submergedDepth,
              waterTintColor: submergedDepth > 0 ? world.getWaterColor(nx, nz) : null,
            });
          }
        }
      }
    }
  }

  return {
    solid: finalizeMeshBuffers(solidBuffers),
    leaf: finalizeMeshBuffers(leafBuffers),
    torch: finalizeMeshBuffers(torchBuffers),
    water: finalizeMeshBuffers(waterBuffers),
    lava: finalizeMeshBuffers(lavaBuffers),
  };
}

function createSnapshotWorld(data) {
  const worldX0 = data.cx * CHUNK_SIZE;
  const worldZ0 = data.cz * CHUNK_SIZE;
  return {
    blocks: data.blocks,
    waterLevels: data.waterLevels,
    skyLights: data.skyLights,
    blockLights: data.blockLights,
    grassColors: data.grassColors,
    foliageColors: data.foliageColors,
    waterColors: data.waterColors,
    generatedColumns: data.generatedColumns,
    columnTopY: data.columnTopY,
    seed: data.seed,
    worldX0,
    worldZ0,
    getBlock(wx, y, wz) {
      return getSnapshotBlock(this, wx - this.worldX0, y, wz - this.worldZ0);
    },
    hasGeneratedColumn(wx, wz) {
      return getSnapshotGeneratedColumn(this, wx - this.worldX0, wz - this.worldZ0);
    },
    getWaterLevel(wx, y, wz) {
      return getSnapshotWaterLevel(this, wx - this.worldX0, y, wz - this.worldZ0);
    },
    getLavaLevel(wx, y, wz) {
      return getSnapshotWaterLevel(this, wx - this.worldX0, y, wz - this.worldZ0);
    },
    isWaterFallingAt(wx, y, wz) {
      return getSnapshotWaterFalling(this, wx - this.worldX0, y, wz - this.worldZ0);
    },
    isLavaFallingAt(wx, y, wz) {
      return getSnapshotWaterFalling(this, wx - this.worldX0, y, wz - this.worldZ0);
    },
    getFluidState(wx, y, wz) {
      return createSnapshotFluidState(this, wx, y, wz);
    },
    getSkyLightLevel(wx, y, wz) {
      return getSnapshotLight(this.skyLights, wx - this.worldX0, y, wz - this.worldZ0, y >= WORLD_HEIGHT ? MAX_LIGHT_LEVEL : 0);
    },
    getBlockLightLevel(wx, y, wz) {
      return getSnapshotLight(this.blockLights, wx - this.worldX0, y, wz - this.worldZ0, 0);
    },
    getCombinedLightLevel(wx, y, wz) {
      return Math.max(this.getSkyLightLevel(wx, y, wz), this.getBlockLightLevel(wx, y, wz));
    },
    getGrassColor(wx, wz) {
      return getSnapshotPackedColor(this.grassColors, wx - this.worldX0, wz - this.worldZ0, 0x79c05a);
    },
    getFoliageColor(wx, wz) {
      return getSnapshotPackedColor(this.foliageColors, wx - this.worldX0, wz - this.worldZ0, 0x59ae30);
    },
    getWaterColor(wx, wz) {
      return getSnapshotPackedColor(this.waterColors, wx - this.worldX0, wz - this.worldZ0, DEFAULT_WATER_TINT);
    },
  };
}

function getSnapshotIndex(x, y, z) {
  return y * PADDED_AREA + (z + 1) * PADDED_SIZE + (x + 1);
}

function getSnapshotColumnTopY(world, x, z) {
  const columnIndex = (z + 1) * PADDED_SIZE + (x + 1);
  for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    if (world.blocks[y * PADDED_AREA + columnIndex] !== Block.AIR) return y;
  }
  return -1;
}

function getSnapshotHeightmapSurfaceY(world, x, z, topY = null) {
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return -1;
  const columnTopY = topY ?? (
    world.columnTopY
      ? world.columnTopY[(z + 1) * PADDED_SIZE + (x + 1)]
      : getSnapshotColumnTopY(world, x, z)
  );
  if (columnTopY < 0) return -1;

  for (let y = columnTopY; y >= 0; y -= 1) {
    const block = getSnapshotBlock(world, x, y, z);
    if (isTerrainHeightmapBlock(block)) return y;
  }
  return -1;
}

function isTerrainHeightmapBlock(block) {
  return isSolid(block) && !isLeafBlock(block) && !isTreeLog(block);
}

function isTreeLog(block) {
  return block === Block.LOG ||
    block === Block.SPRUCE_LOG ||
    block === Block.JUNGLE_LOG ||
    block === Block.BIRCH_LOG ||
    block === Block.ACACIA_LOG ||
    block === Block.DARK_OAK_LOG;
}

function getSnapshotBlock(world, x, y, z) {
  if (y < 0 || y >= WORLD_HEIGHT) return Block.AIR;
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return Block.AIR;
  return world.blocks[getSnapshotIndex(x, y, z)];
}

function getSnapshotGeneratedColumn(world, x, z) {
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return false;
  if (!world.generatedColumns) return true;
  return world.generatedColumns[(z + 1) * PADDED_SIZE + (x + 1)] === 1;
}

function getSnapshotWaterLevel(world, x, y, z) {
  if (y < 0 || y >= WORLD_HEIGHT) return null;
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return null;
  const stored = world.waterLevels[getSnapshotIndex(x, y, z)];
  const storedLevel = stored & WATER_LEVEL_STORE_MASK;
  return storedLevel > 0 ? storedLevel - 1 : null;
}

function getSnapshotWaterFalling(world, x, y, z) {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return false;
  return (world.waterLevels[getSnapshotIndex(x, y, z)] & WATER_FALLING_STORE_FLAG) !== 0;
}

const EMPTY_SNAPSHOT_FLUID_STATE = Object.freeze({
  empty: true,
  type: null,
  fluidId: null,
  falling: false,
  level: null,
  amount: 0,
  isEmpty() {
    return true;
  },
  getLevel() {
    return null;
  },
  getRenderHeight() {
    return 0;
  },
});

function createSnapshotFluidState(world, wx, y, wz) {
  const block = world.getBlock(wx, y, wz);
  const fluidId = isWater(block) ? "water" : isLava(block) ? "lava" : null;
  if (!fluidId) return EMPTY_SNAPSHOT_FLUID_STATE;

  const x = wx - world.worldX0;
  const z = wz - world.worldZ0;
  const level = getSnapshotWaterLevel(world, x, y, z) ?? 0;
  const falling = getSnapshotWaterFalling(world, x, y, z);
  const amount = clamp(8 - level, 1, 8);

  return {
    empty: false,
    fluidId,
    type: {
      id: fluidId,
      isSame(other) {
        return other?.id === fluidId || other === fluidId;
      },
    },
    falling,
    level,
    amount,
    isEmpty() {
      return false;
    },
    getLevel() {
      return level;
    },
    getRenderHeight() {
      if (falling) return 1;
      return Math.max(1 / 16, ((8 - level) * 14) / 128);
    },
  };
}

function getSnapshotLight(lights, x, y, z, fallback) {
  if (!lights || y < 0 || y >= WORLD_HEIGHT) return fallback;
  if (x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return fallback;
  return lights[getSnapshotIndex(x, y, z)];
}

function getSnapshotColorIndex(x, z) {
  return ((z + 1) * PADDED_SIZE + (x + 1)) * 3;
}

function getSnapshotPackedColor(colors, x, z, fallback) {
  if (!colors || x < -1 || x > CHUNK_SIZE || z < -1 || z > CHUNK_SIZE) return fallback;
  const index = getSnapshotColorIndex(x, z);
  return (colors[index] << 16) | (colors[index + 1] << 8) | colors[index + 2];
}

function createMeshBuffers() {
  return {
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    waves: [],
    indices: [],
    vertexCount: 0,
  };
}

function finalizeMeshBuffers(buffers) {
  const IndexArray = buffers.vertexCount > 65535 ? Uint32Array : Uint16Array;
  return {
    positions: new Float32Array(buffers.positions),
    normals: new Float32Array(buffers.normals),
    colors: new Float32Array(buffers.colors),
    uvs: new Float32Array(buffers.uvs),
    waves: new Float32Array(buffers.waves),
    indices: new IndexArray(buffers.indices),
  };
}

function pushVoxelFace(buffers, world, wx, y, wz, block, face, options = {}) {
  const topHeight = options.topHeight ?? 1;
  const topHeights = options.topHeights ?? null;
  const variation = options.variation ?? 1;
  const useAo = options.ao ?? true;
  const waveTop = options.waveTop ?? false;
  const bounds = getBlockBounds(block);
  const packedTint = options.tintColor ?? getBlockTintColor(world, wx, wz, block, face.name);
  const positionOffset = options.positionOffset ?? 0;
  const textureKey = options.textureKey ?? getFaceTextureKey(block, face.name);
  const textureRegion = ATLAS_REGIONS.get(textureKey) ?? ATLAS_REGIONS.get("stone");
  const lightColors = getFaceLightColors(
    world,
    wx,
    y,
    wz,
    face,
    options.lightLevel ?? null,
    options.submergedDepth ?? 0,
  );
  const cornerLight = face.corners.map((corner) =>
    useAo ? getVertexAmbientOcclusion(world, wx, y, wz, face, corner) : 1,
  );

  // terrain faces split sky (rgb) and block light (alpha) for night-time torch rendering
  const hasBlockLightSplit = options.lightLevel === undefined && typeof options.colorAlpha !== "number";
  face.corners.forEach((corner, cornerIndex) => {
    const localX = corner[0] === 1 ? bounds.maxX : bounds.minX;
    const localZ = corner[2] === 1 ? bounds.maxZ : bounds.minZ;
    const localY = corner[1] === 1 ? (topHeights?.[cornerIndex] ?? Math.min(bounds.maxY, topHeight)) : bounds.minY;
    const tintScale = face.shade * variation * cornerLight[cornerIndex];
    const tint = { r: tintScale * lightColors.r, g: tintScale * lightColors.g, b: tintScale * lightColors.b };
    const waterTintColor = options.waterTintColor ?? options.tintColor ?? DEFAULT_WATER_TINT;
    buffers.positions.push(
      wx + localX + face.dir[0] * positionOffset,
      y + localY + face.dir[1] * positionOffset,
      wz + localZ + face.dir[2] * positionOffset,
    );
    buffers.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    pushPackedTintedColor(buffers, tint, packedTint, {
      waterDepth: options.waterDepth ?? 0,
      submergedDepth: options.submergedDepth ?? 0,
      waterTintColor,
      blockIntensity: hasBlockLightSplit ? tintScale * lightColors.blockIntensity : undefined,
    });
    const uv = options.fullTileUv
      ? getFullTileUv(cornerIndex, options.uvShift ?? [0, 0])
      : leafBlockUv(block, textureRegion, cornerIndex, wx, y, wz, face, world.seed, options.uvShift ?? [0, 0]);
    buffers.uvs.push(uv[0], uv[1]);
    buffers.waves.push(waveTop && corner[1] === 1 ? 1 : 0);
  });

  if (cornerLight[0] + cornerLight[2] > cornerLight[1] + cornerLight[3]) {
    buffers.indices.push(
      buffers.vertexCount,
      buffers.vertexCount + 1,
      buffers.vertexCount + 3,
      buffers.vertexCount + 1,
      buffers.vertexCount + 2,
      buffers.vertexCount + 3,
    );
  } else {
    buffers.indices.push(
      buffers.vertexCount,
      buffers.vertexCount + 1,
      buffers.vertexCount + 2,
      buffers.vertexCount,
      buffers.vertexCount + 2,
      buffers.vertexCount + 3,
    );
  }
  buffers.vertexCount += 4;
}

function pushPlant(buffers, world, wx, y, wz, block) {
  if (block === Block.WATERLILY) {
    pushWaterlily(buffers, world, wx, y, wz, block);
    return;
  }

  const aboveIsSame = world.getBlock?.(wx, y + 1, wz) === block;
  const belowIsSame = world.getBlock?.(wx, y - 1, wz) === block;

  // Stacked TALL_GRASS uses dedicated double-plant textures instead of UV-splitting.
  let textureKey;
  if (block === Block.TALL_GRASS && (aboveIsSame || belowIsSame)) {
    textureKey = belowIsSame ? "double_grass_top" : "double_grass_bottom";
  } else {
    textureKey = getFaceTextureKey(block, "py");
  }

  const textureRegion = ATLAS_REGIONS.get(textureKey) ?? ATLAS_REGIONS.get("wildflower");
  const shade = 0.86 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const ao = getTopFaceContactShadow(world, wx, y - 1, wz, [1, 1, 1]);
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const tintScale = shade * lerp(0.82, 1, ao);
  const tint = { r: tintScale * lightColors.r, g: tintScale * lightColors.g, b: tintScale * lightColors.b };
  const plantBlockIntensity = tintScale * lightColors.blockIntensity;
  const packedTint = getPlantTintColor(world, wx, wz, block);

  const ph = (block === Block.SUGAR_CANE || aboveIsSame || belowIsSame) ? 1.0 : 0.86;
  const planes = [
    [
      [0.12, 0, 0.12],
      [0.88, 0, 0.88],
      [0.88, ph, 0.88],
      [0.12, ph, 0.12],
    ],
    [
      [0.88, 0, 0.12],
      [0.12, 0, 0.88],
      [0.12, ph, 0.88],
      [0.88, ph, 0.12],
    ],
  ];
  const uvBounds = getAtlasUvBounds(textureRegion);
  let uv_v0 = uvBounds.v0;
  let uv_v1 = uvBounds.v1;
  // For stacked TALL_GRASS each half has its own dedicated full texture — no UV split needed.
  // For other stacked blocks (sugar cane etc.) keep the original UV-split behaviour.
  if (!(block === Block.TALL_GRASS && (aboveIsSame || belowIsSame))) {
    const vmid = (textureRegion.v0 + textureRegion.v1) / 2;
    if (aboveIsSame && !belowIsSame) uv_v1 = vmid;
    if (!aboveIsSame && belowIsSame) uv_v0 = vmid;
  }
  const uvs = [
    [uvBounds.u0, uv_v0],
    [uvBounds.u1, uv_v0],
    [uvBounds.u1, uv_v1],
    [uvBounds.u0, uv_v1],
  ];

  for (const plane of planes) {
    const start = buffers.vertexCount;
    for (let i = 0; i < 4; i += 1) {
      const vertex = plane[i];
      buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
      buffers.normals.push(0, 1, 0);
      pushPackedTintedColor(buffers, tint, packedTint, { blockIntensity: plantBlockIntensity });
      buffers.uvs.push(uvs[i][0], uvs[i][1]);
      buffers.waves.push(0);
    }
    buffers.indices.push(
      start,
      start + 1,
      start + 2,
      start,
      start + 2,
      start + 3,
      start + 2,
      start + 1,
      start,
      start + 3,
      start + 2,
      start,
    );
    buffers.vertexCount += 4;
  }
}

function pushWaterlily(buffers, world, wx, y, wz, block) {
  const textureRegion = ATLAS_REGIONS.get("waterlily") ?? ATLAS_REGIONS.get("leaves");
  const shade = 0.9 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const tint = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const lilyBlockIntensity = shade * lightColors.blockIntensity;
  const packedTint = getPlantTintColor(world, wx, wz, block);
  const inset = 0.06;
  const py = 0.035;
  const vertices = [
    [inset, py, 1 - inset],
    [1 - inset, py, 1 - inset],
    [1 - inset, py, inset],
    [inset, py, inset],
  ];
  const uvBounds = getAtlasUvBounds(textureRegion);
  const uvs = [
    [uvBounds.u0, uvBounds.v1],
    [uvBounds.u1, uvBounds.v1],
    [uvBounds.u1, uvBounds.v0],
    [uvBounds.u0, uvBounds.v0],
  ];
  const start = buffers.vertexCount;

  for (let i = 0; i < 4; i += 1) {
    const vertex = vertices[i];
    buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
    buffers.normals.push(0, 1, 0);
    pushPackedTintedColor(buffers, tint, packedTint, { blockIntensity: lilyBlockIntensity });
    buffers.uvs.push(uvs[i][0], uvs[i][1]);
    buffers.waves.push(0);
  }
  buffers.indices.push(
    start,
    start + 1,
    start + 2,
    start,
    start + 2,
    start + 3,
    start + 2,
    start + 1,
    start,
    start + 3,
    start + 2,
    start,
  );
  buffers.vertexCount += 4;
}

function pushVine(buffers, world, wx, y, wz, block) {
  const textureRegion = ATLAS_REGIONS.get("vine") ?? ATLAS_REGIONS.get("wildflower");
  const shade = 0.88 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const tint = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const vineBlockIntensity = shade * lightColors.blockIntensity;
  const packedTint = getPlantTintColor(world, wx, wz, block);
  const faces = getVineFaces(world, wx, y, wz);
  const renderFaces = faces.length > 0 ? faces : VINE_FACE_DEFS;
  const uvBounds = getAtlasUvBounds(textureRegion);
  const uvs = [
    [uvBounds.u0, uvBounds.v0],
    [uvBounds.u0, uvBounds.v1],
    [uvBounds.u1, uvBounds.v1],
    [uvBounds.u1, uvBounds.v0],
  ];

  for (const face of renderFaces) {
    const start = buffers.vertexCount;
    for (let i = 0; i < 4; i += 1) {
      const vertex = face.vertices[i];
      buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
      buffers.normals.push(...face.normal);
      pushPackedTintedColor(buffers, tint, packedTint, { blockIntensity: vineBlockIntensity });
      buffers.uvs.push(uvs[i][0], uvs[i][1]);
      buffers.waves.push(0);
    }
    buffers.indices.push(
      start,
      start + 1,
      start + 2,
      start,
      start + 2,
      start + 3,
      start + 2,
      start + 1,
      start,
      start + 3,
      start + 2,
      start,
    );
    buffers.vertexCount += 4;
  }
}

function getBlockShapeForBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  return id ? getBlockShapeById(id) : null;
}

function pushCustomShape(buffers, world, wx, y, wz, block, shape) {
  for (const box of shape.boxes ?? []) {
    pushShapeBox(buffers, world, wx, y, wz, block, box);
  }
  const lightColors = computeLightColors(world, wx, y, wz);
  for (const quad of shape.quads ?? []) {
    pushShapeQuad(buffers, wx, y, wz, quad, lightColors);
  }
}

function pushShapeBox(buffers, world, wx, y, wz, block, box) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = box.bounds;
  const lightColors = computeLightColors(world, wx, y, wz);
  for (const face of FACE_DEFS) {
    const faceSpec = normalizeShapeFaceSpec(box.faces?.[face.name]);
    if (!faceSpec) continue;

    const touchesEdge = faceTouchesBlockEdge(face, minX, minY, minZ, maxX, maxY, maxZ);
    if (touchesEdge) {
      const neighbor = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
      if (isFaceOccluding(neighbor) && neighbor !== block) continue;
    }

    pushShapeBoxFace(buffers, world, wx, y, wz, block, face, faceSpec, box.bounds, lightColors);
  }
}

function normalizeShapeFaceSpec(value) {
  if (!value) return null;
  if (typeof value === "string") return { texture: value, uv: null, rotation: 0, shade: null };
  return { texture: value.texture, uv: value.uv ?? null, rotation: value.rotation ?? 0, shade: value.shade ?? null };
}

function faceTouchesBlockEdge(face, minX, minY, minZ, maxX, maxY, maxZ) {
  if (face.name === "px") return maxX >= 0.999;
  if (face.name === "nx") return minX <= 0.001;
  if (face.name === "py") return maxY >= 0.999;
  if (face.name === "ny") return minY <= 0.001;
  if (face.name === "pz") return maxZ >= 0.999;
  if (face.name === "nz") return minZ <= 0.001;
  return false;
}

function pushShapeBoxFace(buffers, world, wx, y, wz, block, face, faceSpec, bounds, lightColors) {
  const region = ATLAS_REGIONS.get(faceSpec.texture) ?? ATLAS_REGIONS.get("stone");
  const shade = faceSpec.shade ?? face.shade;
  const tintBase = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const shapeBlockIntensity = lightColors.blockIntensity != null ? shade * lightColors.blockIntensity : undefined;
  const start = buffers.vertexCount;
  const cornerUv = computeShapeCornerUv(face, region, bounds, faceSpec);

  face.corners.forEach((corner, cornerIndex) => {
    const localX = corner[0] === 1 ? bounds[3] : bounds[0];
    const localY = corner[1] === 1 ? bounds[4] : bounds[1];
    const localZ = corner[2] === 1 ? bounds[5] : bounds[2];
    buffers.positions.push(wx + localX, y + localY, wz + localZ);
    buffers.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    pushPackedTintedColor(buffers, tintBase, null,
      shapeBlockIntensity != null ? { blockIntensity: shapeBlockIntensity } : undefined);
    const uv = cornerUv[cornerIndex];
    buffers.uvs.push(uv[0], uv[1]);
    buffers.waves.push(0);
  });

  buffers.indices.push(
    start,
    start + 1,
    start + 2,
    start,
    start + 2,
    start + 3,
  );
  buffers.vertexCount += 4;
}

function pushShapeQuad(buffers, wx, y, wz, quad, lightColors) {
  const faceSpec = normalizeShapeFaceSpec(quad.face);
  if (!faceSpec) return;
  const region = ATLAS_REGIONS.get(faceSpec.texture) ?? ATLAS_REGIONS.get("stone");
  const shade = faceSpec.shade ?? 1;
  const tintBase = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const quadBlockIntensity = lightColors.blockIntensity != null ? shade * lightColors.blockIntensity : undefined;
  const start = buffers.vertexCount;
  const cornerUv = computeShapeQuadUv(region, faceSpec);
  const normal = normalizeQuadNormal(quad.normal ?? computeQuadNormal(quad.vertices));

  quad.vertices.forEach((vertex, cornerIndex) => {
    buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
    buffers.normals.push(normal[0], normal[1], normal[2]);
    pushPackedTintedColor(buffers, tintBase, null,
      quadBlockIntensity != null ? { blockIntensity: quadBlockIntensity } : undefined);
    const uv = cornerUv[cornerIndex];
    buffers.uvs.push(uv[0], uv[1]);
    buffers.waves.push(0);
  });

  buffers.indices.push(
    start,
    start + 1,
    start + 2,
    start,
    start + 2,
    start + 3,
  );
  buffers.vertexCount += 4;
}

function computeShapeQuadUv(region, faceSpec) {
  const partial = faceSpec.uv ? computeExplicitUv(region, faceSpec.uv) : [
    [region.u0, region.v0],
    [region.u0, region.v1],
    [region.u1, region.v1],
    [region.u1, region.v0],
  ];
  return rotateCornerUv(partial, faceSpec.rotation);
}

function computeQuadNormal(vertices) {
  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ];
}

function normalizeQuadNormal(normal) {
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function computeShapeCornerUv(face, region, bounds, faceSpec) {
  const partial = faceSpec.uv ? computeExplicitUv(region, faceSpec.uv) : computePartialUv(face, region, bounds);
  return rotateCornerUv(partial, faceSpec.rotation);
}

function computeExplicitUv(region, uv) {
  const uSpan = region.u1 - region.u0;
  const vSpan = region.v1 - region.v0;
  const u0 = region.u0 + uSpan * (uv[0] / 16);
  const u1 = region.u0 + uSpan * (uv[2] / 16);
  const v0 = region.v0 + vSpan * (1 - uv[3] / 16);
  const v1 = region.v0 + vSpan * (1 - uv[1] / 16);
  return [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ];
}

function rotateCornerUv(uv, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 0) return uv;
  if (r === 90) return [uv[1], uv[2], uv[3], uv[0]];
  if (r === 180) return [uv[2], uv[3], uv[0], uv[1]];
  if (r === 270) return [uv[3], uv[0], uv[1], uv[2]];
  return uv;
}

function computePartialUv(face, region, bounds) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const uSpan = region.u1 - region.u0;
  const vSpan = region.v1 - region.v0;
  let u0;
  let u1;
  let v0;
  let v1;
  if (face.name === "px") {
    u0 = region.u0 + uSpan * minZ;
    u1 = region.u0 + uSpan * maxZ;
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else if (face.name === "nx") {
    u0 = region.u0 + uSpan * (1 - maxZ);
    u1 = region.u0 + uSpan * (1 - minZ);
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else if (face.name === "py") {
    u0 = region.u0 + uSpan * (1 - maxZ);
    u1 = region.u0 + uSpan * (1 - minZ);
    v0 = region.v0 + vSpan * minX;
    v1 = region.v0 + vSpan * maxX;
  } else if (face.name === "ny") {
    u0 = region.u0 + uSpan * minZ;
    u1 = region.u0 + uSpan * maxZ;
    v0 = region.v0 + vSpan * minX;
    v1 = region.v0 + vSpan * maxX;
  } else if (face.name === "pz") {
    u0 = region.u0 + uSpan * (1 - maxX);
    u1 = region.u0 + uSpan * (1 - minX);
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else {
    u0 = region.u0 + uSpan * minX;
    u1 = region.u0 + uSpan * maxX;
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  }
  return [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ];
}

function getVineFaces(world, wx, y, wz) {
  const direct = getVineFacesAtY(world, wx, y, wz);
  if (direct.length > 0) return direct;

  for (let oy = 1; oy <= 5; oy += 1) {
    if (world.getBlock(wx, y + oy, wz) !== Block.VINE) break;
    const inherited = getVineFacesAtY(world, wx, y + oy, wz);
    if (inherited.length > 0) return inherited;
  }

  return [];
}

function getVineFacesAtY(world, wx, y, wz) {
  return VINE_FACE_DEFS.filter((face) => {
    const [dx, dz] = face.support;
    return isVineSupportBlock(world.getBlock(wx + dx, y, wz + dz));
  });
}

function getLiquidTintColor(world, wx, wz, block) {
  if (isWater(block)) return world.getWaterColor?.(wx, wz) ?? null;
  return null;
}

function getWaterSurfaceHeight(world, wx, y, wz) {
  return getLiquidSurfaceHeight(world, wx, y, wz, Block.WATER);
}

function getLiquidSurfaceHeight(world, wx, y, wz, liquidBlock) {
  const state = getLiquidFluidState(world, wx, y, wz, liquidBlock);
  if (!state) return 0;
  if (getLiquidFluidState(world, wx, y + 1, wz, liquidBlock)) return 1;
  if (state.falling) return 1;
  if (typeof state.getRenderHeight === "function") return state.getRenderHeight(WATER_MAX_DEPTH);
  const level = getFluidStateLevel(state) ?? 0;
  return Math.max(1 / 16, ((8 - level) * 14) / 128);
}

function isFallingWaterBlock(world, wx, y, wz) {
  return isFallingLiquidBlock(world, wx, y, wz, Block.WATER);
}

function isFallingLiquidBlock(world, wx, y, wz, liquidBlock) {
  const state = getLiquidFluidState(world, wx, y, wz, liquidBlock);
  return Boolean(state?.falling);
}

function shouldRenderFallingLiquidTopCap(world, wx, y, wz, liquidBlock) {
  if (!isFallingLiquidBlock(world, wx, y, wz, liquidBlock)) return false;
  if (!getLiquidFluidState(world, wx, y + 1, wz, liquidBlock)) return false;
  return !isFallingLiquidBlock(world, wx, y + 1, wz, liquidBlock);
}

function getLiquidLevel(world, wx, y, wz, liquidBlock) {
  return getFluidStateLevel(getLiquidFluidState(world, wx, y, wz, liquidBlock));
}

function getWaterDepthAbove(world, wx, y, wz) {
  if (!getLiquidFluidState(world, wx, y, wz, Block.WATER)) return 0;
  let depth = 0;
  for (let sy = y; sy < WORLD_HEIGHT && depth < WATER_DEPTH_VISIBILITY_LIMIT; sy += 1) {
    if (!getLiquidFluidState(world, wx, sy, wz, Block.WATER)) break;
    depth += 1;
  }
  return depth;
}

function getWaterColumnDepth(world, wx, y, wz) {
  if (!getLiquidFluidState(world, wx, y, wz, Block.WATER)) return 0;
  let depth = getWaterDepthAbove(world, wx, y, wz);
  for (let sy = y - 1; sy >= 0 && depth < WATER_DEPTH_VISIBILITY_LIMIT; sy -= 1) {
    if (!getLiquidFluidState(world, wx, sy, wz, Block.WATER)) break;
    depth += 1;
  }
  return depth;
}

function getWaterFaceTopHeights(world, wx, y, wz, face) {
  return getLiquidFaceTopHeights(world, wx, y, wz, Block.WATER, face);
}

function getLiquidFaceTopHeights(world, wx, y, wz, liquidBlock, face) {
  return face.corners.map((corner) => (corner[1] === 1 ? getLiquidCornerHeight(world, wx, y, wz, liquidBlock, corner) : 0));
}

function getWaterCornerHeight(world, wx, y, wz, corner) {
  return getLiquidCornerHeight(world, wx, y, wz, Block.WATER, corner);
}

function getLiquidCornerHeight(world, wx, y, wz, liquidBlock, corner) {
  const sx = corner[0] === 1 ? 1 : -1;
  const sz = corner[2] === 1 ? 1 : -1;
  const offsets = [
    [sx, 0],
    [0, sz],
    [sx, sz],
  ];

  // Any falling-water column at this corner pins it to full block height.
  // Both adjacent cells observe the same 4 cells, so they always agree.
  if (isFallingLiquidBlock(world, wx, y, wz, liquidBlock)) return 1;
  for (const [ox, oz] of offsets) {
    if (isFallingLiquidBlock(world, wx + ox, y, wz + oz, liquidBlock)) return 1;
  }

  const samples = [getLiquidSurfaceHeight(world, wx, y, wz, liquidBlock)];
  for (const [ox, oz] of offsets) {
    if (getLiquidFluidState(world, wx + ox, y, wz + oz, liquidBlock)) {
      samples.push(getLiquidSurfaceHeight(world, wx + ox, y, wz + oz, liquidBlock));
    }
  }

  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function getLiquidFluidState(world, wx, y, wz, liquidBlock) {
  const state = world.getFluidState?.(wx, y, wz);
  if (!state || state.isEmpty?.() || state.empty) return null;
  return getFluidStateId(state) === getLiquidFluidId(liquidBlock) ? state : null;
}

function getLiquidFluidId(liquidBlock) {
  if (isWater(liquidBlock)) return "water";
  if (isLava(liquidBlock)) return "lava";
  return null;
}

function getFluidStateId(state) {
  return state?.type?.id ?? state?.fluidId ?? null;
}

function getFluidStateLevel(state) {
  if (!state) return null;
  if (typeof state.getLevel === "function") return state.getLevel(WATER_MAX_DEPTH);
  return state.level ?? null;
}

function getVertexAmbientOcclusion(world, wx, y, wz, face, corner) {
  if (!smoothLightingEnabled) return 1;
  const axes = getFacePlaneAxes(face.dir);
  const sideA = sampleAoBlock(world, wx, y, wz, face.dir, axes[0], corner);
  const sideB = sampleAoBlock(world, wx, y, wz, face.dir, axes[1], corner);
  const diagonal = sampleAoBlock(world, wx, y, wz, face.dir, axes[0], corner, axes[1]);
  const ao = sideA && sideB ? 0 : 3 - Number(sideA) - Number(sideB) - Number(diagonal);
  let light = 0.66 + ao * 0.1133;

  if (face.name === "py") {
    light *= getTopFaceContactShadow(world, wx, y, wz, corner);
  } else if (face.name !== "ny") {
    light *= getSideFaceContactShadow(world, wx, y, wz, face, corner);
  }

  return clamp(light, 0.45, 1);
}

function getTopFaceContactShadow(world, wx, y, wz, corner) {
  let shadow = 1;
  const sx = corner[0] === 1 ? 1 : -1;
  const sz = corner[2] === 1 ? 1 : -1;
  const sideX = isSolid(world.getBlock(wx + sx, y + 1, wz));
  const sideZ = isSolid(world.getBlock(wx, y + 1, wz + sz));
  const diagonal = isSolid(world.getBlock(wx + sx, y + 1, wz + sz));
  const oppositeX = isSolid(world.getBlock(wx - sx, y + 1, wz));
  const oppositeZ = isSolid(world.getBlock(wx, y + 1, wz - sz));

  if (isSolid(world.getBlock(wx, y + 2, wz))) shadow *= 0.7;
  if (sideX) shadow *= 0.8;
  if (sideZ) shadow *= 0.8;
  if (diagonal) shadow *= 0.88;
  if ((sideX && oppositeZ) || (sideZ && oppositeX) || (sideX && sideZ)) shadow *= 0.68;

  return shadow;
}

function getSideFaceContactShadow(world, wx, y, wz, face, corner) {
  let shadow = 1;
  const above = isSolid(world.getBlock(wx, y + 1, wz));
  const ledge = isSolid(world.getBlock(wx + face.dir[0], y + 1, wz + face.dir[2]));
  const belowLedge = isSolid(world.getBlock(wx + face.dir[0], y - 1, wz + face.dir[2]));
  const sideAxis = face.dir[0] !== 0 ? 2 : 0;
  const side = corner[sideAxis] === 1 ? 1 : -1;
  const sideBlock = sideAxis === 2
    ? isSolid(world.getBlock(wx + face.dir[0], y, wz + side))
    : isSolid(world.getBlock(wx + side, y, wz + face.dir[2]));

  if (above) shadow *= 0.9;
  if (ledge) shadow *= 0.86;
  if (belowLedge) shadow *= 0.94;
  if (sideBlock) shadow *= 0.92;
  return shadow;
}

function getFacePlaneAxes(dir) {
  if (dir[0] !== 0) return [1, 2];
  if (dir[1] !== 0) return [0, 2];
  return [0, 1];
}

function sampleAoBlock(world, wx, y, wz, dir, axisA, corner, axisB = null) {
  const offset = [dir[0], dir[1], dir[2]];
  offset[axisA] += corner[axisA] === 1 ? 1 : -1;
  if (axisB !== null) offset[axisB] += corner[axisB] === 1 ? 1 : -1;
  return isSolid(world.getBlock(wx + offset[0], y + offset[1], wz + offset[2]));
}

function getFaceTextureKey(block, faceName) {
  const extraTexture = getExtraBlockFaceTexture(block, faceName);
  if (extraTexture) return extraTexture;

  if (block === Block.GRASS) {
    if (faceName === "py") return "grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }

  if (block === Block.LOG) return faceName === "py" || faceName === "ny" ? "log_top" : "log_side";
  if (block === Block.SPRUCE_LOG) return faceName === "py" || faceName === "ny" ? "spruce_log_top" : "spruce_log_side";
  if (block === Block.JUNGLE_LOG) return faceName === "py" || faceName === "ny" ? "jungle_log_top" : "jungle_log_side";
  if (block === Block.ACACIA_LOG) return faceName === "py" || faceName === "ny" ? "acacia_log_top" : "acacia_log_side";
  if (block === Block.DARK_OAK_LOG) return faceName === "py" || faceName === "ny" ? "dark_oak_log_top" : "dark_oak_log_side";
  if (block === Block.CRAFTING_TABLE) {
    if (faceName === "py") return "crafting_top";
    if (faceName === "nz") return "crafting_front";
    return "crafting_side";
  }
  if (block === Block.PODZOL) {
    if (faceName === "py") return "podzol_top";
    if (faceName === "ny") return "dirt";
    return "podzol_side";
  }
  if (block === Block.JUNGLE_GRASS) {
    if (faceName === "py") return "jungle_grass_top";
    if (faceName === "ny") return "mud";
    return "mud";
  }
  if (block === Block.MEADOW_GRASS) {
    if (faceName === "py") return "meadow_grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }
  if (block === Block.SAVANNA_GRASS) {
    if (faceName === "py") return "savanna_grass_top";
    if (faceName === "ny") return "coarse_dirt";
    return "coarse_dirt";
  }
  if (block === Block.DRY_GRASS) {
    if (faceName === "py") return "dry_grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }
  if (block === Block.CACTUS) return faceName === "py" || faceName === "ny" ? "cactus_top" : "cactus_side";
  if (block === Block.BIRCH_LOG) return faceName === "py" || faceName === "ny" ? "birch_log_top" : "birch_log_side";
  if (block === Block.SNOW_GRASS) {
    if (faceName === "py") return "snow";
    if (faceName === "ny") return "dirt";
    return "snow_grass_side";
  }
  if (block === Block.MYCELIUM) {
    if (faceName === "py") return "mycelium_top";
    if (faceName === "ny") return "dirt";
    return "mycelium_side";
  }
  if (block === Block.WATER) return "water";
  if (block === Block.DIRT) return "dirt";
  if (block === Block.STONE) return "stone";
  if (block === Block.SAND) return "sand";
  if (block === Block.SANDSTONE) return "sandstone";
  if (block === Block.GRAVEL) return "gravel";
  if (block === Block.COBBLESTONE) return "cobblestone";
  if (block === Block.COAL_ORE) return "coal_ore";
  if (block === Block.IRON_ORE) return "iron_ore";
  if (block === Block.COPPER_ORE) return "copper_ore";
  if (block === Block.GOLD_ORE) return "gold_ore";
  if (block === Block.DIAMOND_ORE) return "diamond_ore";
  if (block === Block.RED_SAND) return "red_sand";
  if (block === Block.TERRACOTTA) return "terracotta";
  if (block === Block.WHITE_TERRACOTTA) return "white_terracotta";
  if (block === Block.SNOW) return "snow";
  if (block === Block.BIRCH_LEAVES) return "birch_leaves";
  if (block === Block.ACACIA_LEAVES) return "acacia_leaves";
  if (block === Block.DARK_OAK_LEAVES) return "dark_oak_leaves";
  if (block === Block.MOSS) return "moss";
  if (block === Block.WILDFLOWER) return "wildflower";
  if (block === Block.FERN) return "fern";
  if (block === Block.TALL_GRASS) return "tall_grass";
  if (block === Block.GRANITE) return "granite";
  if (block === Block.DIORITE) return "diorite";
  if (block === Block.ANDESITE) return "andesite";
  if (block === Block.DEEPSLATE) return "deepslate";
  if (block === Block.ICE) return "ice";
  if (block === Block.PACKED_ICE) return "packed_ice";
  if (block === Block.DANDELION) return "dandelion";
  if (block === Block.POPPY) return "poppy";
  if (block === Block.BLUE_ORCHID) return "blue_orchid";
  if (block === Block.DEAD_BUSH) return "dead_bush";
  if (block === Block.BERRY_BUSH) return "berry_bush";
  if (block === Block.SUGAR_CANE) return "sugar_cane";
  if (block === Block.PUMPKIN) return faceName === "py" || faceName === "ny" ? "pumpkin_top" : "pumpkin_side";
  if (block === Block.MELON) return faceName === "py" || faceName === "ny" ? "melon_top" : "melon_side";
  if (block === Block.VINE) return "vine";
  if (block === Block.COARSE_DIRT) return "coarse_dirt";
  if (block === Block.CLOVER) return "clover";
  if (block === Block.SAVANNA_SHRUB) return "savanna_shrub";
  if (block === Block.BROWN_MUSHROOM) return "brown_mushroom";
  if (block === Block.RED_MUSHROOM) return "red_mushroom";
  if (block === Block.SUNFLOWER) return "sunflower";
  if (block === Block.WATERLILY) return "waterlily";
  if (block === Block.LIMESTONE) return "limestone";
  if (block === Block.BASALT) return "basalt";
  if (block === Block.SLATE) return "slate";
  if (block === Block.LEAVES) return "leaves";
  if (block === Block.SPRUCE_LEAVES) return "spruce_leaves";
  if (block === Block.JUNGLE_LEAVES) return "jungle_leaves";
  if (block === Block.PLANK) return "plank";
  if (block === Block.CLAY) return "clay";
  if (block === Block.MUD) return "mud";
  if (block === Block.BEDROCK) return "bedrock";
  return "stone";
}

function createAtlasRegions() {
  const size = ATLAS_TILE_SIZE;
  const width = ATLAS_COLUMNS * ATLAS_CELL_SIZE;
  const height = ATLAS_ROWS * ATLAS_CELL_SIZE;
  const regions = new Map();

  BLOCK_TEXTURE_KEYS.forEach((key, index) => {
    const x = (index % ATLAS_COLUMNS) * ATLAS_CELL_SIZE + ATLAS_TILE_PADDING;
    const y = Math.floor(index / ATLAS_COLUMNS) * ATLAS_CELL_SIZE + ATLAS_TILE_PADDING;
    regions.set(key, {
      u0: x / width,
      u1: (x + size) / width,
      v0: 1 - (y + size) / height,
      v1: 1 - y / height,
    });
  });

  return regions;
}

function getFaceUv(region, cornerIndex, shift = [0, 0]) {
  const { u0, u1, v0, v1 } = getAtlasUvBounds(region);
  const uv = [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ][cornerIndex];
  return [uv[0] + shift[0], uv[1] + shift[1]];
}

function leafBlockUv(block, region, cornerIndex, wx, y, wz, face, seed, shift = [0, 0]) {
  if (!isLeafBlock(block)) return getFaceUv(region, cornerIndex, shift);
  const { u0, u1, v0, v1 } = getAtlasUvBounds(region);
  let [u, v] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ][cornerIndex];
  const salt = face.name.charCodeAt(0) * 31 + face.name.charCodeAt(1);
  const variant = Math.floor(hashFloat(wx + y * 17, wz - y * 31, seed ^ salt ^ 0x1eaf) * 8) & 7;
  if (variant & 1) u = 1 - u;
  if (variant & 2) v = 1 - v;
  if (variant & 4) [u, v] = [v, 1 - u];
  return [lerp(u0, u1, u) + shift[0], lerp(v0, v1, v) + shift[1]];
}

function getAtlasUvBounds(region) {
  const uInset = (region.u1 - region.u0) / (ATLAS_TILE_SIZE * 2);
  const vInset = (region.v1 - region.v0) / (ATLAS_TILE_SIZE * 2);
  return {
    u0: region.u0 + uInset,
    u1: region.u1 - uInset,
    v0: region.v0 + vInset,
    v1: region.v1 - vInset,
  };
}

function getFullTileUv(cornerIndex, shift = [0, 0]) {
  const inset = 0.001;
  const uv = [
    [inset, inset],
    [inset, 1 - inset],
    [1 - inset, 1 - inset],
    [1 - inset, inset],
  ][cornerIndex];
  return [uv[0] + shift[0], uv[1] + shift[1]];
}

function isSolid(block) {
  return SOLID_MASK[block] === 1;
}

function isWater(block) {
  return block === Block.WATER;
}

function isLava(block) {
  return EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "lava";
}

function isLiquid(block) {
  return isWater(block) || isLava(block);
}

function isSameLiquid(a, b) {
  return (isWater(a) && isWater(b)) || (isLava(a) && isLava(b));
}

function isPlant(block) {
  return PLANT_MASK[block] === 1;
}

function isLeafBlock(block) {
  return LEAF_MASK[block] === 1;
}

function shouldRenderSharedLeafFace(face) {
  return face.dir[0] > 0 || face.dir[1] > 0 || face.dir[2] > 0;
}

function isVineSupportBlock(block) {
  return isFaceOccluding(block) || isLeafBlock(block);
}

function isFaceOccluding(block) {
  if (EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.transparent) return false;
  return isSolid(block) && block !== Block.CACTUS;
}

function isTorchCustomShapeBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id ?? "";
  return id === "torch_on" || id.startsWith("torch_on_wall_") || id.includes("redstone_torch");
}

function getFaceLightLevel(world, wx, y, wz, face) {
  return world.getCombinedLightLevel?.(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]) ?? MAX_LIGHT_LEVEL;
}

function minecraftLightFactor(level) {
  return skyLightFactor(level);
}

function skyLightFactor(level) {
  if (fullBrightLightingEnabled) return 1;
  return minecraftBrightnessFactor(level);
}

function blockLightFactor(level) {
  if (fullBrightLightingEnabled) return 1;
  if (level <= 0) return 0;
  return minecraftBrightnessFactor(level) * MAX_BLOCK_LIGHT_FACTOR;
}

function minecraftBrightnessFactor(level) {
  const normalized = clamp(level / MAX_LIGHT_LEVEL, 0, 1);
  const darkness = 1 - normalized;
  const vanilla = normalized / (darkness * 3 + 1);
  return MIN_LIGHT_FACTOR + vanilla * (1 - MIN_LIGHT_FACTOR);
}

function attenuateSkyLightForWater(sky, waterDepth) {
  if (waterDepth <= 0 || sky <= 0) return sky;
  const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, waterDepth);
  const loss = Math.round(lerp(WATER_SKY_LIGHT_LOSS_MIN, WATER_SKY_LIGHT_LOSS_MAX, t));
  return clamp(sky - loss, 0, MAX_LIGHT_LEVEL);
}

// Returns per-channel {r,g,b} sky light factors. Block light is kept as
// neutral intensity in alpha so torches brighten blocks without tinting them.
function computeLightColors(world, wx, y, wz, optLevel = null, waterDepth = 0) {
  if (fullBrightLightingEnabled) return { r: 1, g: 1, b: 1, blockIntensity: 1 };
  let sky, block;
  if (optLevel != null) {
    sky = 0;
    block = optLevel;
  } else {
    sky = world.getSkyLightLevel?.(wx, y, wz) ?? MAX_LIGHT_LEVEL;
    block = world.getBlockLightLevel?.(wx, y, wz) ?? 0;
    sky = attenuateSkyLightForWater(sky, waterDepth);
  }
  const sf = skyLightFactor(sky);
  const bf = blockLightFactor(block);
  // For lava (optLevel set): keep combined max in RGB for LAVA_MATERIAL compatibility
  if (optLevel != null) {
    const light = Math.max(sf, bf);
    return { r: light, g: light, b: light, blockIntensity: 0 };
  }
  // For terrain: sky in RGB, block light intensity in alpha for night-time torch support
  return { r: sf, g: sf, b: sf, blockIntensity: bf };
}

function getFaceLightColors(world, wx, y, wz, face, optLevel = null, waterDepth = 0) {
  return computeLightColors(world, wx + face.dir[0], y + face.dir[1], wz + face.dir[2], optLevel, waterDepth);
}

function getBlockBounds(block) {
  return block === Block.CACTUS ? CACTUS_BLOCK_BOUNDS : FULL_BLOCK_BOUNDS;
}

function getLeafTintColor(world, wx, wz, block) {
  if (block === Block.BIRCH_LEAVES) return BIRCH_FOLIAGE_COLOR;
  if (block === Block.SPRUCE_LEAVES) return SPRUCE_FOLIAGE_COLOR;
  if (block === Block.DARK_OAK_LEAVES) return 0x285424;
  return world.getFoliageColor(wx, wz);
}

function getBlockTintColor(world, wx, wz, block, faceName) {
  if (isLeafBlock(block)) return getLeafTintColor(world, wx, wz, block);
  if (GRASS_TINT_MASK[block] === 1 && faceName === "py") return world.getGrassColor(wx, wz);
  return null;
}

function hasGrassSideOverlay(block, faceName) {
  return GRASS_TINT_MASK[block] === 1 && faceName !== "py" && faceName !== "ny";
}

function getPlantTintColor(world, wx, wz, block) {
  if (GRASS_TINT_PLANT_MASK[block] === 1) return world.getGrassColor(wx, wz);
  if (FOLIAGE_TINT_PLANT_MASK[block] === 1) return world.getFoliageColor(wx, wz);
  return null;
}

function pushPackedTintedColor(buffers, light, packedColor, options = {}) {
  const lr = typeof light === "object" ? light.r : light;
  const lg = typeof light === "object" ? light.g : light;
  const lb = typeof light === "object" ? light.b : light;
  let r;
  let g;
  let b;
  if (packedColor === null) {
    r = lr;
    g = lg;
    b = lb;
  } else {
    r = (((packedColor >> 16) & 0xff) / 255) * lr;
    g = (((packedColor >> 8) & 0xff) / 255) * lg;
    b = ((packedColor & 0xff) / 255) * lb;
  }

  if (options.waterDepth > 0) {
    const water = getWaterDepthTintColor(packedColor ?? DEFAULT_WATER_TINT, options.waterDepth);
    r = water.r * lr;
    g = water.g * lg;
    b = water.b * lb;
  }

  if (options.submergedDepth > 0) {
    const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, options.submergedDepth);
    const water = unpackColor(options.waterTintColor ?? UNDERWATER_WATER_TINT);
    const haze = lerp(0.18, 0.58, t);
    const visibility = lerp(0.9, 0.66, t);
    const avgLight = (lr + lg + lb) / 3;
    r = lerp(r, water.r * avgLight, haze) * visibility;
    g = lerp(g, water.g * avgLight, haze) * visibility;
    b = lerp(b, water.b * avgLight, haze) * lerp(0.98, 0.94, t);
  }

  if (typeof options.colorAlpha === "number") {
    buffers.colors.push(r, g, b, clamp(options.colorAlpha, 0, 1));
  } else if (typeof options.blockIntensity === "number") {
    buffers.colors.push(r, g, b, options.blockIntensity);
  } else {
    buffers.colors.push(r, g, b);
  }
}

function unpackColor(packedColor) {
  return {
    r: ((packedColor >> 16) & 0xff) / 255,
    g: ((packedColor >> 8) & 0xff) / 255,
    b: (packedColor & 0xff) / 255,
  };
}

function getWaterDepthTintColor(packedColor, depth) {
  const t = Math.pow(smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, depth), 0.82);
  const base = unpackColor(packedColor ?? DEFAULT_WATER_TINT);
  const shallow = mixColor(base, unpackColor(SHALLOW_WATER_TINT), 0.82);
  const deep = mixColor(base, unpackColor(DEEP_WATER_TINT), 0.9);
  return mixColor(shallow, deep, t);
}

function getWaterDepthAlpha(depth) {
  const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, depth);
  return lerp(WATER_DEPTH_ALPHA_MIN, WATER_DEPTH_ALPHA_MAX, Math.pow(t, 0.58));
}

function mixColor(a, b, t) {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashFloat(x, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ (seed | 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
