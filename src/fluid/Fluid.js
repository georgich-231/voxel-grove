import { FluidState } from "./FluidState.js";

export class Fluid {
  constructor(id, options = {}) {
    this.id = id;
    this.options = options;
  }

  defaultFluidState() {
    return FluidState.empty();
  }

  getBucket() {
    return null;
  }

  animateTick() {}

  randomTick() {}

  entityInside() {}

  canBeReplacedWith() {
    return false;
  }

  getFlow() {
    return [0, 0, 0];
  }

  getTickDelay() {
    return 5;
  }

  isRandomlyTicking() {
    return false;
  }

  isEmpty() {
    return false;
  }

  getExplosionResistance() {
    return 100;
  }

  getHeight(fluidState, world, wx, y, wz) {
    if (world.getFluidState(wx, y + 1, wz).type?.isSame(this)) return 1;
    return fluidState.getOwnHeight();
  }

  getOwnHeight(fluidState) {
    return fluidState.getAmount() / 9;
  }

  createLegacyBlock(fluidState, fluidBlock) {
    return fluidBlock.createLegacyBlock(this, fluidState);
  }

  isSource(fluidState) {
    return fluidState.isSource();
  }

  getAmount(fluidState) {
    return fluidState.getAmount();
  }

  isSame(other) {
    return other === this || other?.id === this.id;
  }
}
