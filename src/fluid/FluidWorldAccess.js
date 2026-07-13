import { EMPTY_FLUID_STATE, FluidState } from "./FluidState.js";
import { FluidTickScheduler } from "./FluidTickScheduler.js";
import { HORIZONTAL_DIRECTIONS } from "./FlowingFluid.js";

function fluidKey(wx, y, wz) {
  return `${wx},${y},${wz}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stateLevel(state, maxDepth) {
  return state.getLevel(maxDepth) ?? 0;
}

export function createFluidWorldMethods(config) {
  const {
    Block,
    WORLD_HEIGHT,
    WATER_MAX_DEPTH,
    WATER_FLOW_UPDATES_PER_STEP,
    WATER_PLACED_FLOW_DELAY_TICKS,
    WATER_MAX_FLOW_DISTANCE,
    LAVA_MAX_FLOW_DISTANCE,
    LAVA_FLOW_UPDATES_PER_STEP,
    LAVA_PLACED_FLOW_DELAY_TICKS,
    fluidBlock,
    fluids,
    isSolid,
    isLava,
    isReplaceableBlock,
    isFluidBreakableBlock = () => false,
    isIceBlock,
    getObsidianBlock,
  } = config;

  const fluidById = new Map(fluids.map((fluid) => [fluid.id, fluid]));
  const waterFluid = fluidById.get("water");
  const lavaFluid = fluidById.get("lava");

  return {
    ensureFluidRuntime() {
      if (!this.modifiedWaterLevels) this.modifiedWaterLevels = new Map();
      if (!this.modifiedWaterFalling) this.modifiedWaterFalling = new Set();
      if (!this.modifiedLavaLevels) this.modifiedLavaLevels = new Map();
      if (!this.lavaLevels) this.lavaLevels = new Map();
      if (!this.waterSources) this.waterSources = new Set();
      if (!this.lavaSources) this.lavaSources = new Set();

      if (!Array.isArray(this.waterQueue)) this.waterQueue = [];
      if (!Array.isArray(this.lavaQueue)) this.lavaQueue = [];
      if (!Number.isFinite(this.waterQueueHead)) this.waterQueueHead = 0;
      if (!Number.isFinite(this.lavaQueueHead)) this.lavaQueueHead = 0;
      if (!(this.waterQueued instanceof Map)) this.waterQueued = new Map();
      if (!(this.lavaQueued instanceof Map)) this.lavaQueued = new Map();
      if (!Number.isFinite(this.waterTick)) this.waterTick = 0;
      if (!Number.isFinite(this.lavaTick)) this.lavaTick = 0;

      if (!Array.isArray(this.waterFlowPlanQueue)) this.waterFlowPlanQueue = [];
      if (!Number.isFinite(this.waterFlowPlanQueueHead)) this.waterFlowPlanQueueHead = 0;
      if (!(this.waterFlowPlanQueued instanceof Map)) this.waterFlowPlanQueued = new Map();
      if (!Number.isFinite(this.waterFlowPlanToken)) this.waterFlowPlanToken = 0;

      this.fluidBlock = fluidBlock;
      this.fluidTypes = fluidById;
      this.waterTickDelay = WATER_PLACED_FLOW_DELAY_TICKS;
      this.lavaTickDelay = LAVA_PLACED_FLOW_DELAY_TICKS;
      this.waterSlopeFindDistance = WATER_MAX_FLOW_DISTANCE;
      this.lavaSlopeFindDistance = LAVA_MAX_FLOW_DISTANCE;

      if (!this.fluidTickSchedulers) {
        this.fluidTickSchedulers = new Map();
      }
      if (!this.fluidTickSchedulers.has("water")) {
        this.fluidTickSchedulers.set("water", new FluidTickScheduler(this, waterFluid, {
          queueProp: "waterQueue",
          headProp: "waterQueueHead",
          queuedProp: "waterQueued",
          tickProp: "waterTick",
        }));
      }
      if (!this.fluidTickSchedulers.has("lava")) {
        this.fluidTickSchedulers.set("lava", new FluidTickScheduler(this, lavaFluid, {
          queueProp: "lavaQueue",
          headProp: "lavaQueueHead",
          queuedProp: "lavaQueued",
          tickProp: "lavaTick",
        }));
      }
    },

    isFluidYInBounds(y) {
      return y > 0 && y < WORLD_HEIGHT;
    },

    getFluidType(idOrFluid) {
      this.ensureFluidRuntime();
      return typeof idOrFluid === "string" ? this.fluidTypes.get(idOrFluid) : idOrFluid;
    },

    fluidIdForBlock(block) {
      this.ensureFluidRuntime();
      return this.fluidBlock.getFluidIdForBlock(block);
    },

    getFluidState(wx, y, wz, block = this.getBlock(wx, y, wz)) {
      this.ensureFluidRuntime();
      if (!this.isFluidYInBounds(y)) return EMPTY_FLUID_STATE;

      const fluidId = this.fluidIdForBlock(block);
      if (!fluidId) return EMPTY_FLUID_STATE;

      const fluid = this.getFluidType(fluidId);
      const key = fluidKey(wx, y, wz);
      const level = this.readStoredFluidLevel(wx, y, wz, fluidId);
      const falling = this.readStoredFluidFalling(wx, y, wz, fluidId);
      const amount = clamp(8 - (level ?? 0), 1, 8);
      const sourceSet = fluidId === "water" ? this.waterSources : this.lavaSources;
      const generatedSource = fluidId === "water" && level === 0 && !falling && !this.modified?.has(key);
      const source = !falling && level === 0 && (generatedSource || sourceSet.has(key));

      return new FluidState(fluid, { amount, falling, source });
    },

    readStoredFluidLevel(wx, y, wz, fluidId) {
      if (!this.isFluidYInBounds(y)) return null;
      const key = fluidKey(wx, y, wz);
      if (fluidId === "water") {
        if (this.modifiedWaterLevels?.has(key)) return this.modifiedWaterLevels.get(key);
      } else if (fluidId === "lava") {
        if (this.modifiedLavaLevels?.has(key)) return this.modifiedLavaLevels.get(key);
        if (this.lavaLevels?.has(key)) return this.lavaLevels.get(key);
      }

      const cx = Math.floor(wx / config.CHUNK_SIZE);
      const cz = Math.floor(wz / config.CHUNK_SIZE);
      const chunk = this.chunks?.get(this.key(cx, cz));
      return chunk?.getWaterLevelLocal(config.mod(wx, config.CHUNK_SIZE), y, config.mod(wz, config.CHUNK_SIZE)) ?? 0;
    },

    readStoredFluidFalling(wx, y, wz) {
      if (!this.isFluidYInBounds(y)) return false;
      const key = fluidKey(wx, y, wz);
      if (this.modifiedWaterFalling?.has(key)) return true;

      const cx = Math.floor(wx / config.CHUNK_SIZE);
      const cz = Math.floor(wz / config.CHUNK_SIZE);
      const chunk = this.chunks?.get(this.key(cx, cz));
      return chunk?.isWaterFallingLocal(config.mod(wx, config.CHUNK_SIZE), y, config.mod(wz, config.CHUNK_SIZE)) ?? false;
    },

    setFluidState(wx, y, wz, state, options = {}) {
      this.ensureFluidRuntime();
      if (!this.isFluidYInBounds(y)) return false;

      if (!state || state.isEmpty()) {
        const currentState = this.getFluidState(wx, y, wz);
        if (currentState.isEmpty()) return false;
        const removed = this.setBlock(wx, y, wz, Block.AIR, {
          skipWaterUpdate: true,
          skipLavaUpdate: true,
          skipLiquidInteractions: true,
        });
        if (removed && !options.skipFluidUpdate) this.queueFluidAround(currentState.type, wx, y, wz, currentState.type.getTickDelay(this));
        return removed;
      }

      const fluid = state.type;
      const fluidId = fluid.id;
      const block = this.fluidBlock.getBlockForFluid(fluid);
      if (block == null) return false;

      const currentBlock = this.getBlock(wx, y, wz);
      if (fluidId === "water" && isLava(currentBlock)) {
        return this.mixWaterIntoLava(wx, y, wz, options.direction ?? null);
      }
      if (fluidId === "lava" && currentBlock === Block.WATER) {
        return this.mixLavaIntoWater(wx, y, wz, options.direction ?? null);
      }
      if (fluidId === "lava" && currentBlock !== block && this.canCreateBasaltAt?.(wx, y, wz)) {
        return this.setBlock(wx, y, wz, Block.BASALT, { skipLiquidInteractions: true });
      }

      const currentState = this.getFluidState(wx, y, wz, currentBlock);
      if (!currentState.isEmpty() && currentState.type?.isSame(fluid)) {
        if (currentState.equals(state)) return false;
        if (!options.forceFluidUpdate && !this.shouldReplaceFluidState(currentState, state)) return false;
      } else if (!this.canHoldAnyFluid(wx, y, wz, fluid)) {
        return false;
      }

      const level = stateLevel(state, WATER_MAX_DEPTH);
      const placed = this.setBlock(wx, y, wz, block, {
        waterLevel: fluidId === "water" ? level : undefined,
        waterFalling: fluidId === "water" ? state.falling : undefined,
        lavaLevel: fluidId === "lava" ? level : undefined,
        lavaFalling: fluidId === "lava" ? state.falling : undefined,
        isSource: state.isSource(),
        skipWaterUpdate: true,
        skipLavaUpdate: true,
        skipLiquidInteractions: true,
        direction: options.direction ?? null,
      });
      if (!placed) return false;

      if (!options.skipFluidUpdate) {
        this.queueFluidTick(fluid, wx, y, wz, fluid.getTickDelay(this), { replaceExisting: true });
        this.queueFluidAround(fluid, wx, y, wz, fluid.getTickDelay(this));
      }
      return true;
    },

    shouldReplaceFluidState(currentState, nextState) {
      if (nextState.falling && !currentState.falling) return true;
      if (nextState.getLevel(WATER_MAX_DEPTH) < currentState.getLevel(WATER_MAX_DEPTH)) return true;
      if (nextState.isSource() && !currentState.isSource()) return true;
      return false;
    },

    queueFluidTick(fluidOrId, wx, y, wz, delayTicks, options = {}) {
      this.ensureFluidRuntime();
      const fluid = this.getFluidType(fluidOrId);
      this.fluidTickSchedulers.get(fluid.id)?.queue(wx, y, wz, delayTicks, options);
    },

    queueFluidAround(fluidOrId, wx, y, wz, delayTicks) {
      const fluid = this.getFluidType(fluidOrId);
      this.queueFluidTick(fluid, wx, y, wz, delayTicks);
      this.queueFluidTick(fluid, wx, y + 1, wz, delayTicks);
      this.queueFluidTick(fluid, wx, y - 1, wz, delayTicks);
      for (const direction of HORIZONTAL_DIRECTIONS) {
        this.queueFluidTick(fluid, wx + direction.dx, y, wz + direction.dz, delayTicks);
      }
    },

    stepFluid(fluidOrId, maxUpdates) {
      this.ensureFluidRuntime();
      const fluid = this.getFluidType(fluidOrId);
      this.fluidTickSchedulers.get(fluid.id)?.step(maxUpdates);
    },

    updateFluidAt(fluidOrId, wx, y, wz) {
      const fluid = this.getFluidType(fluidOrId);
      if (this.resolveLiquidInteractionAt?.(wx, y, wz)) return;
      const state = this.getFluidState(wx, y, wz);
      if (!state.type?.isSame(fluid)) {
        this.queueAdjacentFluidSources(fluid, wx, y, wz);
        return;
      }
      fluid.tick(this, wx, y, wz, state);
    },

    queueAdjacentFluidSources(fluid, wx, y, wz) {
      for (const direction of HORIZONTAL_DIRECTIONS) {
        if (this.getFluidState(wx + direction.dx, y, wz + direction.dz).type?.isSame(fluid)) {
          this.queueFluidTick(fluid, wx + direction.dx, y, wz + direction.dz, fluid.getTickDelay(this));
        }
      }
      if (this.getFluidState(wx, y + 1, wz).type?.isSame(fluid)) {
        this.queueFluidTick(fluid, wx, y + 1, wz, fluid.getTickDelay(this));
      }
    },

    scheduleWaterFlowPlan(wx, y, wz, delayTicks = WATER_PLACED_FLOW_DELAY_TICKS) {
      this.queueWater(wx, y, wz, delayTicks);
    },

    queueWater(wx, y, wz, delayTicks = WATER_PLACED_FLOW_DELAY_TICKS) {
      this.queueFluidTick(waterFluid, wx, y, wz, delayTicks);
    },

    sortWaterQueue() {
      this.ensureFluidRuntime();
      this.fluidTickSchedulers.get("water").sort();
    },

    queueWaterAround(wx, y, wz, delayTicks = WATER_PLACED_FLOW_DELAY_TICKS) {
      this.queueFluidAround(waterFluid, wx, y, wz, delayTicks);
    },

    stepWater(maxUpdates = WATER_FLOW_UPDATES_PER_STEP) {
      this.stepFluid(waterFluid, maxUpdates);
    },

    updateWaterAt(wx, y, wz) {
      this.updateFluidAt(waterFluid, wx, y, wz);
    },

    readWaterState(wx, y, wz, block = this.getBlock(wx, y, wz)) {
      return this.getFluidState(wx, y, wz, block);
    },

    getUpdatedWaterState(wx, y, wz) {
      return waterFluid.getNewLiquid(this, wx, y, wz);
    },

    setWaterState(wx, y, wz, state, options = {}) {
      const fluidState = state instanceof FluidState
        ? state
        : state?.empty
          ? EMPTY_FLUID_STATE
          : new FluidState(waterFluid, {
            amount: clamp(8 - (state?.level ?? 0), 1, 8),
            falling: Boolean(state?.falling),
            source: Boolean(state?.source),
          });
      return this.setFluidState(wx, y, wz, fluidState, options);
    },

    getWaterLevel(wx, y, wz) {
      if (!this.isFluidYInBounds(y)) return null;
      if (this.getBlock(wx, y, wz) !== Block.WATER) return null;
      return this.readStoredFluidLevel(wx, y, wz, "water");
    },

    isWaterFallingAt(wx, y, wz) {
      if (!this.isFluidYInBounds(y)) return false;
      if (this.getBlock(wx, y, wz) !== Block.WATER) return false;
      return this.readStoredFluidFalling(wx, y, wz, "water");
    },

    isWaterSourceAt(wx, y, wz) {
      return this.getFluidState(wx, y, wz).isSourceOfType(waterFluid);
    },

    getDropOff() {
      return waterFluid.getDropOff(this);
    },

    getSlopeFindDistance() {
      return waterFluid.getSlopeFindDistance(this);
    },

    canConvertToSourceWater() {
      return waterFluid.canConvertToSource(this);
    },

    sourceNeighborCount(wx, y, wz) {
      return waterFluid.sourceNeighborCount(this, wx, y, wz);
    },

    canWaterFlowInto(wx, y, wz) {
      return this.canHoldAnyFluid(wx, y, wz, waterFluid);
    },

    canMaybePassThrough(sourceWx, sourceY, sourceWz, directionName, targetWx, targetY, targetWz) {
      const direction = HORIZONTAL_DIRECTIONS.find((entry) => entry.name === directionName) ?? { name: directionName };
      return waterFluid.canMaybePassThrough(this, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz);
    },

    canWaterPassThrough(sourceWx, sourceY, sourceWz, directionName, targetWx, targetY, targetWz) {
      const direction = HORIZONTAL_DIRECTIONS.find((entry) => entry.name === directionName) ?? { name: directionName };
      return waterFluid.canPassThrough(
        this,
        sourceWx,
        sourceY,
        sourceWz,
        direction,
        targetWx,
        targetY,
        targetWz,
        this.getFluidState(targetWx, targetY, targetWz),
      );
    },

    isWaterHole(wx, y, wz) {
      return waterFluid.isWaterHole(this, wx, y, wz);
    },

    spreadWater(wx, y, wz, fluidState = this.getFluidState(wx, y, wz)) {
      return waterFluid.spread(this, wx, y, wz, fluidState);
    },

    spreadWaterToSides(wx, y, wz, fluidState = this.getFluidState(wx, y, wz)) {
      return waterFluid.spreadToSides(this, wx, y, wz, fluidState);
    },

    getWaterSpread(wx, y, wz) {
      return waterFluid.getSpread(this, wx, y, wz);
    },

    getSlopeDistance(wx, y, wz, pass, fromDirectionName, context) {
      return waterFluid.getSlopeDistance(this, wx, y, wz, pass, fromDirectionName, context);
    },

    setLavaBlock(wx, y, wz, level, options = {}) {
      const state = new FluidState(lavaFluid, {
        amount: clamp(8 - level, 1, 8),
        falling: Boolean(options.falling ?? options.lavaFalling),
        source: Boolean(options.isSource ?? level === 0),
      });
      return this.setFluidState(wx, y, wz, state, options);
    },

    queueLava(wx, y, wz, delayTicks = LAVA_PLACED_FLOW_DELAY_TICKS) {
      this.queueFluidTick(lavaFluid, wx, y, wz, this.normalizeLavaDelay(delayTicks));
    },

    sortLavaQueue() {
      this.ensureFluidRuntime();
      this.fluidTickSchedulers.get("lava").sort();
    },

    queueLavaAround(wx, y, wz, delayTicks = LAVA_PLACED_FLOW_DELAY_TICKS) {
      this.queueFluidAround(lavaFluid, wx, y, wz, this.normalizeLavaDelay(delayTicks));
    },

    normalizeLavaDelay(delayTicks) {
      return delayTicks === WATER_PLACED_FLOW_DELAY_TICKS ? lavaFluid.getTickDelay(this) : delayTicks;
    },

    stepLava(maxUpdates = LAVA_FLOW_UPDATES_PER_STEP) {
      this.stepFluid(lavaFluid, maxUpdates);
    },

    updateLavaAt(wx, y, wz) {
      this.updateFluidAt(lavaFluid, wx, y, wz);
    },

    getLavaLevel(wx, y, wz) {
      if (!this.isFluidYInBounds(y)) return null;
      if (!isLava(this.getBlock(wx, y, wz))) return null;
      return this.readStoredFluidLevel(wx, y, wz, "lava");
    },

    isLavaFallingAt(wx, y, wz) {
      if (!this.isFluidYInBounds(y)) return false;
      if (!isLava(this.getBlock(wx, y, wz))) return false;
      return this.readStoredFluidFalling(wx, y, wz, "lava");
    },

    isLavaSourceAt(wx, y, wz) {
      return this.getFluidState(wx, y, wz).isSourceOfType(lavaFluid);
    },

    canHoldAnyFluid(wx, y, wz, fluid) {
      if (!this.isFluidYInBounds(y)) return false;
      return this.canFluidFlowInto(this.getBlock(wx, y, wz), fluid);
    },

    canHoldSpecificFluid(wx, y, wz, stateOrFluid) {
      if (!this.isFluidYInBounds(y)) return false;
      const fluid = stateOrFluid instanceof FluidState ? stateOrFluid.type : this.getFluidType(stateOrFluid);
      if (!fluid) return false;
      const block = this.getBlock(wx, y, wz);
      if (fluid.id === "water" && isLava(block)) return true;
      if (fluid.id === "lava" && block === Block.WATER) return true;
      return this.canFluidFlowInto(block, fluid);
    },

    canFluidFlowInto(block, fluidOrId) {
      const fluid = this.getFluidType(fluidOrId);
      const blockFluidId = this.fluidIdForBlock(block);
      if (block === Block.AIR || isReplaceableBlock(block)) return true;
      if (blockFluidId === fluid?.id) return true;
      if (fluid?.id === "water" && isLava(block)) return true;
      if (fluid?.id === "lava" && block === Block.WATER) return true;
      return false;
    },

    shouldFluidBreakBlock(wx, y, wz, fluidOrId) {
      const fluid = this.getFluidType(fluidOrId);
      return Boolean(fluid && isFluidBreakableBlock(this.getBlock(wx, y, wz), fluid));
    },

    canLiquidFlowInto(block, liquidBlock) {
      const fluidId = this.fluidIdForBlock(liquidBlock);
      return this.canFluidFlowInto(block, fluidId);
    },

    canLiquidFallInto(block, liquidBlock) {
      const fluidId = this.fluidIdForBlock(liquidBlock);
      if (this.fluidIdForBlock(block) === fluidId) return false;
      return this.canFluidFlowInto(block, fluidId);
    },

    canFluidPassThrough(sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz, fluid) {
      const sourceBlock = this.getBlock(sourceWx, sourceY, sourceWz);
      const targetBlock = this.getBlock(targetWx, targetY, targetWz);
      const fluidId = this.getFluidType(fluid)?.id;
      const sourceFluidId = this.fluidIdForBlock(sourceBlock);
      const targetFluidId = this.fluidIdForBlock(targetBlock);

      if (isSolid(sourceBlock) && sourceFluidId !== fluidId && !isReplaceableBlock(sourceBlock)) return false;
      if (isSolid(targetBlock) && targetFluidId !== fluidId && !isReplaceableBlock(targetBlock)) return false;
      return true;
    },

    blocksMotion(wx, y, wz) {
      const block = this.getBlock(wx, y, wz);
      return isSolid(block) && !isReplaceableBlock(block);
    },

    isSolidBlock(blockOrWx, y = null, wz = null) {
      if (y === null || wz === null) {
        return isSolid(blockOrWx) && !isReplaceableBlock(blockOrWx);
      }
      const wx = Math.floor(blockOrWx);
      const wy = Math.floor(y);
      const zz = Math.floor(wz);
      if (wy < 0) return true;
      if (!this.isFluidYInBounds(wy)) return false;
      if (typeof this.hasGeneratedChunkAt === "function" && !this.hasGeneratedChunkAt(wx, zz)) return true;
      const block = typeof this.getLoadedBlock === "function"
        ? this.getLoadedBlock(wx, wy, zz)
        : this.getBlock(wx, wy, zz);
      return isSolid(block) && !isReplaceableBlock(block);
    },

    isFaceSturdy(wx, y, wz) {
      const block = this.getBlock(wx, y, wz);
      return isSolid(block) && !isReplaceableBlock(block);
    },

    isIceBlock(wx, y, wz) {
      return isIceBlock(this.getBlock(wx, y, wz));
    },

    mixWaterIntoLava(wx, y, wz, direction = null) {
      if (!isLava(this.getBlock(wx, y, wz))) return false;
      const reactionBlock = this.isLavaSourceAt(wx, y, wz) ? getObsidianBlock() : Block.COBBLESTONE;
      return this.setBlock(wx, y, wz, reactionBlock, { skipLiquidInteractions: true });
    },

    mixLavaIntoWater(wx, y, wz, direction = null) {
      if (this.getBlock(wx, y, wz) !== Block.WATER) return false;
      const flowsDown = !direction || direction[1] < 0;
      const reactionBlock = flowsDown ? Block.STONE : Block.COBBLESTONE;
      return this.setBlock(wx, y, wz, reactionBlock, { skipLiquidInteractions: true });
    },

    resolveLiquidInteractionsAround(wx, y, wz) {
      let changed = false;
      for (const [dx, dy, dz] of [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        changed = this.resolveLiquidInteractionAt(wx + dx, y + dy, wz + dz) || changed;
      }
      return changed;
    },

    resolveLiquidInteractionAt(wx, y, wz) {
      const state = this.getFluidState(wx, y, wz);
      if (state.type?.isSame(lavaFluid)) {
        if (this.getFluidState(wx, y - 1, wz).type?.isSame(waterFluid)) {
          return this.mixLavaIntoWater(wx, y - 1, wz, [0, -1, 0]);
        }
        if (this.getFluidState(wx, y + 1, wz).type?.isSame(waterFluid)) {
          return this.mixWaterIntoLava(wx, y, wz, [0, -1, 0]);
        }
        for (const direction of HORIZONTAL_DIRECTIONS) {
          if (this.getFluidState(wx + direction.dx, y, wz + direction.dz).type?.isSame(waterFluid)) {
            return this.mixWaterIntoLava(wx, y, wz, [-direction.dx, 0, -direction.dz]);
          }
        }
        return false;
      }

      if (!state.type?.isSame(waterFluid)) return false;
      if (this.getFluidState(wx, y + 1, wz).type?.isSame(lavaFluid)) {
        return this.mixLavaIntoWater(wx, y, wz, [0, -1, 0]);
      }
      if (this.getFluidState(wx, y - 1, wz).type?.isSame(lavaFluid)) {
        return this.mixWaterIntoLava(wx, y - 1, wz, [0, -1, 0]);
      }

      let changed = false;
      for (const direction of HORIZONTAL_DIRECTIONS) {
        if (this.getFluidState(wx + direction.dx, y, wz + direction.dz).type?.isSame(lavaFluid)) {
          changed = this.mixWaterIntoLava(wx + direction.dx, y, wz + direction.dz, direction.vector) || changed;
        }
      }
      return changed;
    },

    hardenLavaAt(wx, y, wz) {
      return this.mixWaterIntoLava(wx, y, wz);
    },

    canCreateSourceLava(wx, y, wz) {
      return lavaFluid.canConvertToSource(this) && lavaFluid.sourceNeighborCount(this, wx, y, wz) >= 2;
    },
  };
}
