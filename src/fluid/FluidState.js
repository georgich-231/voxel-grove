function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class FluidState {
  constructor(type, options = {}) {
    this.type = type ?? null;
    this.amount = clamp(options.amount ?? 0, 0, 8);
    this.falling = Boolean(options.falling);
    this.source = Boolean(options.source);
    this.empty = Boolean(options.empty || !type);
  }

  static empty() {
    return EMPTY_FLUID_STATE;
  }

  isEmpty() {
    return this.empty;
  }

  isSource() {
    return !this.empty && this.source;
  }

  isSourceOfType(fluid) {
    return this.type?.isSame(fluid) === true && this.isSource();
  }

  isSameType(fluid) {
    return !this.empty && this.type?.isSame(fluid) === true;
  }

  getAmount() {
    return this.empty ? 0 : this.amount;
  }

  getLevel(maxDepth = 7) {
    if (this.empty) return null;
    return clamp(8 - this.amount, 0, maxDepth);
  }

  getOwnHeight() {
    return this.empty ? 0 : this.type.getOwnHeight(this);
  }

  getHeight(world, wx, y, wz) {
    return this.empty ? 0 : this.type.getHeight(this, world, wx, y, wz);
  }

  getRenderHeight(maxDepth = 7) {
    if (this.empty) return 0;
    if (this.falling) return 1;
    const level = this.getLevel(maxDepth) ?? 0;
    return Math.max(1 / 16, ((8 - level) * 14) / 128);
  }

  getFlow(world, wx, y, wz) {
    return this.empty ? [0, 0, 0] : this.type.getFlow(world, wx, y, wz, this);
  }

  canBeReplacedWith(world, wx, y, wz, otherFluid, direction) {
    if (this.empty) return true;
    return this.type.canBeReplacedWith(this, world, wx, y, wz, otherFluid, direction);
  }

  equals(other) {
    return (
      Boolean(other) &&
      this.type === other.type &&
      this.amount === other.amount &&
      this.falling === other.falling &&
      this.source === other.source &&
      this.empty === other.empty
    );
  }
}

export const EMPTY_FLUID_STATE = Object.freeze(new FluidState(null, { empty: true }));
