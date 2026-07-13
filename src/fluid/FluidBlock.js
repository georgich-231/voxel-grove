export class FluidBlock {
  constructor() {
    this.blockByFluidId = new Map();
    this.fluidIdByBlock = new Map();
  }

  register(fluid, block) {
    if (!fluid || block == null) return this;
    this.blockByFluidId.set(fluid.id, block);
    this.fluidIdByBlock.set(block, fluid.id);
    return this;
  }

  getBlockForFluid(fluid) {
    return this.blockByFluidId.get(fluid?.id ?? fluid) ?? null;
  }

  getFluidIdForBlock(block) {
    return this.fluidIdByBlock.get(block) ?? null;
  }

  isFluidBlock(block) {
    return this.fluidIdByBlock.has(block);
  }

  createLegacyBlock(fluid, fluidState) {
    return {
      block: this.getBlockForFluid(fluid),
      fluidState,
    };
  }
}
