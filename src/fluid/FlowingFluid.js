import { Fluid } from "./Fluid.js";
import { FluidState } from "./FluidState.js";

export const HORIZONTAL_DIRECTIONS = Object.freeze([
  { name: "east", dx: 1, dy: 0, dz: 0, opposite: "west", vector: [1, 0, 0] },
  { name: "west", dx: -1, dy: 0, dz: 0, opposite: "east", vector: [-1, 0, 0] },
  { name: "south", dx: 0, dy: 0, dz: 1, opposite: "north", vector: [0, 0, 1] },
  { name: "north", dx: 0, dy: 0, dz: -1, opposite: "south", vector: [0, 0, -1] },
]);

export const DOWN = Object.freeze({ name: "down", dx: 0, dy: -1, dz: 0, opposite: "up", vector: [0, -1, 0] });
export const UP = Object.freeze({ name: "up", dx: 0, dy: 1, dz: 0, opposite: "down", vector: [0, 1, 0] });

const SLOPE_MISS_DISTANCE = 1000;

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z);
  return length > 0 ? [x / length, y / length, z / length] : [0, 0, 0];
}

export class FlowingFluid extends Fluid {
  getFlowing() {
    return this;
  }

  getFlowingState(amount, falling) {
    return new FluidState(this.getFlowing(), {
      amount,
      falling,
      source: false,
    });
  }

  getSource() {
    return this;
  }

  getSourceState(falling = false) {
    return new FluidState(this.getSource(), {
      amount: 8,
      falling,
      source: !falling,
    });
  }

  defaultFluidState() {
    return this.getSourceState(false);
  }

  affectsFlow(neighborFluid) {
    return neighborFluid.isEmpty() || neighborFluid.type?.isSame(this);
  }

  getFlow(world, wx, y, wz, fluidState) {
    let flowX = 0;
    let flowZ = 0;

    for (const direction of HORIZONTAL_DIRECTIONS) {
      const nx = wx + direction.dx;
      const nz = wz + direction.dz;
      const neighborFluid = world.getFluidState(nx, y, nz);
      if (!this.affectsFlow(neighborFluid)) continue;

      let neighborHeight = neighborFluid.getOwnHeight();
      let distance = 0;
      if (neighborHeight === 0) {
        if (!world.blocksMotion(nx, y, nz)) {
          const belowNeighbor = world.getFluidState(nx, y - 1, nz);
          if (this.affectsFlow(belowNeighbor)) {
            neighborHeight = belowNeighbor.getOwnHeight();
            if (neighborHeight > 0) distance = fluidState.getOwnHeight() - (neighborHeight - 0.8888889);
          }
        }
      } else if (neighborHeight > 0) {
        distance = fluidState.getOwnHeight() - neighborHeight;
      }

      if (distance !== 0) {
        flowX += direction.dx * distance;
        flowZ += direction.dz * distance;
      }
    }

    let [x, outY, z] = normalizeVector(flowX, 0, flowZ);
    if (fluidState.falling) {
      for (const direction of HORIZONTAL_DIRECTIONS) {
        if (
          this.isSolidFace(world, wx + direction.dx, y, wz + direction.dz, direction) ||
          this.isSolidFace(world, wx + direction.dx, y + 1, wz + direction.dz, direction)
        ) {
          [x, outY, z] = normalizeVector(x, outY, z);
          outY -= 6;
          break;
        }
      }
    }

    return normalizeVector(x, outY, z);
  }

  isSolidFace(world, wx, y, wz, direction) {
    const fluidState = world.getFluidState(wx, y, wz);
    if (fluidState.type?.isSame(this)) return false;
    if (direction.name === "up") return true;
    return !world.isIceBlock(wx, y, wz) && world.isFaceSturdy(wx, y, wz, direction);
  }

  spread(world, wx, y, wz, fluidState) {
    if (fluidState.isEmpty()) return;

    const belowY = y - 1;
    const belowFluid = world.getFluidState(wx, belowY, wz);
    if (this.canMaybePassThrough(world, wx, y, wz, DOWN, wx, belowY, wz, belowFluid)) {
      const newBelowFluid = this.getNewLiquid(world, wx, belowY, wz);
      if (
        !newBelowFluid.isEmpty() &&
        belowFluid.canBeReplacedWith(world, wx, belowY, wz, newBelowFluid.type, DOWN) &&
        this.canHoldSpecificFluid(world, wx, belowY, wz, newBelowFluid)
      ) {
        const flowedDown = this.spreadTo(world, wx, belowY, wz, DOWN, newBelowFluid);
        if (flowedDown && this.sourceNeighborCount(world, wx, y, wz) >= 3) {
          this.spreadToSides(world, wx, y, wz, fluidState);
        }
        if (flowedDown) return;
      }
    }

    if (fluidState.isSource() || !this.isWaterHole(world, wx, y, wz)) {
      this.spreadToSides(world, wx, y, wz, fluidState);
    }
  }

  spreadToSides(world, wx, y, wz, fluidState) {
    let neighborAmount = fluidState.getAmount() - this.getDropOff(world);
    if (fluidState.falling) neighborAmount = 7;
    if (neighborAmount <= 0) return;

    const spreads = this.getSpread(world, wx, y, wz, fluidState);
    for (const [directionName, newNeighborFluid] of spreads) {
      const direction = HORIZONTAL_DIRECTIONS.find((entry) => entry.name === directionName);
      if (!direction) continue;
      this.spreadTo(world, wx + direction.dx, y, wz + direction.dz, direction, newNeighborFluid);
    }
  }

  getNewLiquid(world, wx, y, wz) {
    let highestNeighbor = 0;
    let neighborSources = 0;

    for (const direction of HORIZONTAL_DIRECTIONS) {
      const nx = wx + direction.dx;
      const nz = wz + direction.dz;
      const fluidState = world.getFluidState(nx, y, nz);
      if (fluidState.type?.isSame(this) && this.canPassThroughWall(world, wx, y, wz, direction, nx, y, nz)) {
        if (fluidState.isSource()) neighborSources += 1;
        highestNeighbor = Math.max(highestNeighbor, fluidState.getAmount());
      }
    }

    if (neighborSources >= 2 && this.canConvertToSource(world)) {
      const belowFluid = world.getFluidState(wx, y - 1, wz);
      if (world.isSolidBlock(world.getBlock(wx, y - 1, wz)) || this.isSourceBlockOfThisType(belowFluid)) {
        return this.getSourceState(false);
      }
    }

    const aboveFluid = world.getFluidState(wx, y + 1, wz);
    if (
      !aboveFluid.isEmpty() &&
      aboveFluid.type?.isSame(this) &&
      this.canPassThroughWall(world, wx, y, wz, UP, wx, y + 1, wz)
    ) {
      return this.getFlowingState(8, true);
    }

    const amount = highestNeighbor - this.getDropOff(world);
    return amount <= 0 ? FluidState.empty() : this.getFlowingState(amount, false);
  }

  canPassThroughWall(world, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz) {
    return world.canFluidPassThrough(sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz, this);
  }

  spreadTo(world, wx, y, wz, direction, targetState) {
    return world.setFluidState(wx, y, wz, targetState, { direction: direction.vector });
  }

  getSlopeDistance(world, wx, y, wz, pass, fromDirectionName, context) {
    let lowest = SLOPE_MISS_DISTANCE;

    for (const direction of HORIZONTAL_DIRECTIONS) {
      if (direction.name === fromDirectionName) continue;
      const nx = wx + direction.dx;
      const nz = wz + direction.dz;
      context.getBlockState(nx, y, nz);
      const testFluidState = world.getFluidState(nx, y, nz);
      if (!this.canPassThrough(world, wx, y, wz, direction, nx, y, nz, testFluidState)) continue;
      if (context.isHole(nx, y, nz)) return pass;

      if (pass < this.getSlopeFindDistance(world)) {
        const candidate = this.getSlopeDistance(world, nx, y, nz, pass + 1, direction.opposite, context);
        if (candidate < lowest) lowest = candidate;
      }
    }

    return lowest;
  }

  isWaterHole(world, wx, y, wz) {
    const belowY = y - 1;
    if (!this.canPassThroughWall(world, wx, y, wz, DOWN, wx, belowY, wz)) return false;
    const belowFluid = world.getFluidState(wx, belowY, wz);
    return belowFluid.type?.isSame(this) || this.canHoldFluid(world, wx, belowY, wz, this.getFlowing());
  }

  canPassThrough(world, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz, targetFluidState) {
    return (
      this.canMaybePassThrough(world, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz, targetFluidState) &&
      this.canHoldSpecificFluid(world, targetWx, targetY, targetWz, this.getFlowingState(1, false))
    );
  }

  canMaybePassThrough(world, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz, targetFluidState = null) {
    const fluidState = targetFluidState ?? world.getFluidState(targetWx, targetY, targetWz);
    return (
      !this.isSourceBlockOfThisType(fluidState) &&
      world.canHoldAnyFluid(targetWx, targetY, targetWz, this) &&
      this.canPassThroughWall(world, sourceWx, sourceY, sourceWz, direction, targetWx, targetY, targetWz)
    );
  }

  isSourceBlockOfThisType(state) {
    return state.type?.isSame(this) === true && state.isSource();
  }

  sourceNeighborCount(world, wx, y, wz) {
    let count = 0;
    for (const direction of HORIZONTAL_DIRECTIONS) {
      if (this.isSourceBlockOfThisType(world.getFluidState(wx + direction.dx, y, wz + direction.dz))) count += 1;
    }
    return count;
  }

  getSpread(world, wx, y, wz, fluidState = world.getFluidState(wx, y, wz)) {
    let lowest = SLOPE_MISS_DISTANCE;
    const result = new Map();
    const context = new SpreadContext(world, this, wx, y, wz);

    for (const direction of HORIZONTAL_DIRECTIONS) {
      const nx = wx + direction.dx;
      const nz = wz + direction.dz;
      const targetFluidState = world.getFluidState(nx, y, nz);
      if (!this.canMaybePassThrough(world, wx, y, wz, direction, nx, y, nz, targetFluidState)) continue;

      const newFluid = this.getNewLiquid(world, nx, y, nz);
      if (newFluid.isEmpty()) continue;
      if (!this.canHoldSpecificFluid(world, nx, y, nz, newFluid)) continue;

      const breaksBlock = world.shouldFluidBreakBlock?.(nx, y, nz, this) ?? false;
      const distance = breaksBlock
        ? 0
        : context.isHole(nx, y, nz)
        ? 0
        : this.getSlopeDistance(world, nx, y, nz, 1, direction.opposite, context);

      if (distance < lowest) result.clear();
      if (distance <= lowest) {
        if (targetFluidState.canBeReplacedWith(world, nx, y, nz, newFluid.type, direction)) {
          result.set(direction.name, newFluid);
        }
        lowest = distance;
      }
    }

    return result;
  }

  canHoldFluid(world, wx, y, wz, fluid) {
    return world.canHoldAnyFluid(wx, y, wz, fluid) && world.canHoldSpecificFluid(wx, y, wz, fluid);
  }

  canHoldSpecificFluid(world, wx, y, wz, stateOrFluid) {
    return world.canHoldSpecificFluid(wx, y, wz, stateOrFluid);
  }

  tick(world, wx, y, wz, fluidState) {
    if (!fluidState.isSource()) {
      const newFluidState = this.getNewLiquid(world, wx, y, wz);
      const tickDelay = this.getSpreadDelay(world, wx, y, wz, fluidState, newFluidState);
      if (newFluidState.isEmpty()) {
        world.setFluidState(wx, y, wz, FluidState.empty());
        fluidState = newFluidState;
      } else if (!newFluidState.equals(fluidState)) {
        const changed = world.setFluidState(wx, y, wz, newFluidState, { forceFluidUpdate: true });
        fluidState = newFluidState;
        if (changed) world.queueFluidTick(newFluidState.type, wx, y, wz, tickDelay);
      }
    }

    this.spread(world, wx, y, wz, fluidState);
  }

  getSpreadDelay(world) {
    return this.getTickDelay(world);
  }

  getHeight(fluidState, world, wx, y, wz) {
    return world.getFluidState(wx, y + 1, wz).type?.isSame(this) ? 1 : fluidState.getOwnHeight();
  }

  getOwnHeight(fluidState) {
    return fluidState.getAmount() / 9;
  }

  getAmount(fluidState) {
    return fluidState.getAmount();
  }
}

class SpreadContext {
  constructor(world, fluid, originX, originY, originZ) {
    this.world = world;
    this.fluid = fluid;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    this.stateCache = new Map();
    this.holeCache = new Map();
  }

  key(wx, y, wz) {
    return `${wx - this.originX},${y - this.originY},${wz - this.originZ}`;
  }

  getBlockState(wx, y, wz) {
    const key = this.key(wx, y, wz);
    let state = this.stateCache.get(key);
    if (!state) {
      state = {
        block: this.world.getBlock(wx, y, wz),
        fluidState: this.world.getFluidState(wx, y, wz),
      };
      this.stateCache.set(key, state);
    }
    return state;
  }

  isHole(wx, y, wz) {
    const key = this.key(wx, y, wz);
    if (this.holeCache.has(key)) return this.holeCache.get(key);
    const result = this.fluid.isWaterHole(this.world, wx, y, wz);
    this.holeCache.set(key, result);
    return result;
  }
}
