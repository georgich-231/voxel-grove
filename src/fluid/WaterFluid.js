import { DOWN, FlowingFluid } from "./FlowingFluid.js";

export class WaterFluid extends FlowingFluid {
  constructor(options = {}) {
    super("water", options);
  }

  getBucket() {
    return "bucket_water";
  }

  canConvertToSource(world) {
    return Boolean(world.waterSourceConversion);
  }

  beforeDestroyingBlock() {}

  entityInside() {}

  getSlopeFindDistance(world) {
    return world.waterSlopeFindDistance ?? 4;
  }

  getDropOff() {
    return 1;
  }

  getTickDelay(world) {
    return world.waterTickDelay ?? 5;
  }

  canBeReplacedWith(state, world, wx, y, wz, otherFluid, direction) {
    return direction.name === DOWN.name && !otherFluid?.isSame(this);
  }

  getExplosionResistance() {
    return 100;
  }
}
