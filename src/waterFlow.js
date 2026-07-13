import {
  Block,
  CHUNK_SIZE,
  WATER_FLOW_UPDATES_PER_STEP,
  WATER_MAX_DEPTH,
  WATER_MAX_FLOW_DISTANCE,
  WATER_PLACED_FLOW_DELAY_TICKS,
  WORLD_HEIGHT,
  isLava,
  isSolid,
  mod,
} from "./main.js";
import { EXTRA_BLOCK_DEFINITIONS, EXTRA_BLOCK_DEFINITION_BY_BLOCK } from "./creativeContent.js";
import { FluidBlock } from "./fluid/FluidBlock.js";
import { createFluidWorldMethods } from "./fluid/FluidWorldAccess.js";
import { LavaFluid } from "./fluid/LavaFluid.js";
import { WaterFluid } from "./fluid/WaterFluid.js";

const WATER_FLUID = new WaterFluid();
const LAVA_FLUID = new LavaFluid();

const LAVA_BLOCK = EXTRA_BLOCK_DEFINITIONS.find((definition) => definition.id === "lava")?.block ?? null;
const OBSIDIAN_BLOCK = EXTRA_BLOCK_DEFINITIONS.find((definition) => definition.id === "obsidian")?.block ?? null;
const LAVA_PLACED_FLOW_DELAY_TICKS = 30;
const LAVA_MAX_FLOW_DISTANCE = 2;

let installedMethods = null;

function isReplaceableByFluid(block) {
  if (block === Block.AIR) return true;
  if (isLava(block)) return true;
  if (block === Block.SUGAR_CANE) return false;
  const extra = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  if (isFluidBreakableBlock(block)) return true;
  if (extra && /door|sign|ladder|sugar_cane|reeds|bubble_column|portal|structure_void/.test(extra.id)) return false;
  return !isSolid(block);
}

function isFluidBreakableBlock(block, fluid = null) {
  const fluidId = fluid?.id ?? fluid;
  if (fluidId && fluidId !== "water") return false;
  const extra = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  return (
    extra?.id === "torch_on" ||
    extra?.id?.startsWith("torch_on_wall_") ||
    extra?.id?.includes("redstone_torch")
  );
}

function getInstalledMethods() {
  if (!installedMethods) {
    const fluidBlock = new FluidBlock()
      .register(WATER_FLUID, Block.WATER)
      .register(LAVA_FLUID, LAVA_BLOCK);

    installedMethods = createFluidWorldMethods({
      Block,
      CHUNK_SIZE,
      WORLD_HEIGHT,
      WATER_MAX_DEPTH,
      WATER_FLOW_UPDATES_PER_STEP,
      WATER_PLACED_FLOW_DELAY_TICKS,
      WATER_MAX_FLOW_DISTANCE,
      LAVA_MAX_FLOW_DISTANCE,
      LAVA_FLOW_UPDATES_PER_STEP: WATER_FLOW_UPDATES_PER_STEP,
      LAVA_PLACED_FLOW_DELAY_TICKS,
      fluidBlock,
      fluids: [WATER_FLUID, LAVA_FLUID],
      isSolid,
      isLava,
      isReplaceableBlock: isReplaceableByFluid,
      isFluidBreakableBlock,
      isIceBlock: (block) => block === Block.ICE || block === Block.PACKED_ICE,
      getObsidianBlock: () => OBSIDIAN_BLOCK ?? Block.COBBLESTONE,
      mod,
    });
  }
  return installedMethods;
}

export const waterMethods = new Proxy({}, {
  ownKeys() {
    return Reflect.ownKeys(getInstalledMethods());
  },
  getOwnPropertyDescriptor(target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(getInstalledMethods(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  get(target, property) {
    return getInstalledMethods()[property];
  },
});
