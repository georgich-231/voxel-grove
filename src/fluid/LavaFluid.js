import { DOWN, FlowingFluid } from "./FlowingFluid.js";

export class LavaFluid extends FlowingFluid {
  constructor(options = {}) {
    super("lava", options);
  }

  getBucket() {
    return "bucket_lava";
  }

  canConvertToSource(world) {
    return Boolean(world.lavaSourceConversion);
  }

  getSlopeFindDistance(world) {
    return world.lavaSlopeFindDistance ?? 2;
  }

  getDropOff() {
    return 2;
  }

  getTickDelay(world) {
    return world.lavaTickDelay ?? 30;
  }

  canBeReplacedWith(state, world, wx, y, wz, otherFluid, direction) {
    return direction.name === DOWN.name && !otherFluid?.isSame(this);
  }

  getExplosionResistance() {
    return 100;
  }
}
