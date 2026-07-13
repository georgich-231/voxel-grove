export class FluidTickScheduler {
  constructor(world, fluid, options) {
    this.world = world;
    this.fluid = fluid;
    this.queueProp = options.queueProp;
    this.headProp = options.headProp;
    this.queuedProp = options.queuedProp;
    this.tickProp = options.tickProp;
  }

  ensure() {
    if (!Array.isArray(this.world[this.queueProp])) this.world[this.queueProp] = [];
    if (!Number.isFinite(this.world[this.headProp])) this.world[this.headProp] = 0;
    if (!(this.world[this.queuedProp] instanceof Map)) this.world[this.queuedProp] = new Map();
    if (!Number.isFinite(this.world[this.tickProp])) this.world[this.tickProp] = 0;
  }

  key(wx, y, wz) {
    return `${wx},${y},${wz}`;
  }

  queue(wx, y, wz, delayTicks = this.fluid.getTickDelay(this.world), options = {}) {
    this.ensure();
    if (!this.world.isFluidYInBounds(y)) return;

    const key = this.key(wx, y, wz);
    const dueTick = this.world[this.tickProp] + Math.max(0, delayTicks | 0);
    const queuedTick = this.world[this.queuedProp].get(key);
    if (queuedTick !== undefined) {
      if (options.replaceExisting) {
        if (queuedTick === dueTick) return;
      } else if (queuedTick <= dueTick) {
        return;
      }
    }

    this.world[this.queuedProp].set(key, dueTick);
    const queue = this.world[this.queueProp];
    const previousDueTick = queue[queue.length - 1]?.dueTick ?? -Infinity;
    queue.push({ wx, y, wz, key, dueTick });
    if (dueTick < previousDueTick) this.sort();
  }

  sort() {
    this.ensure();
    const head = this.world[this.headProp];
    const queue = this.world[this.queueProp];
    const processed = head > 0 ? queue.slice(0, head) : [];
    const pending = queue.slice(head).sort((a, b) => a.dueTick - b.dueTick);
    this.world[this.queueProp] = processed.concat(pending);
  }

  step(maxUpdates) {
    this.ensure();
    this.world[this.tickProp] += 1;
    if (this.world[this.queueProp].length - this.world[this.headProp] > 1) this.sort();

    let updates = 0;
    while (updates < maxUpdates && this.world[this.headProp] < this.world[this.queueProp].length) {
      const item = this.world[this.queueProp][this.world[this.headProp]];
      if (item.dueTick > this.world[this.tickProp]) break;

      this.world[this.headProp] += 1;
      if (this.world[this.queuedProp].get(item.key) !== item.dueTick) continue;
      this.world[this.queuedProp].delete(item.key);

      this.world.updateFluidAt(this.fluid, item.wx, item.y, item.wz);
      updates += 1;
    }

    if (this.world[this.headProp] > 2048 || this.world[this.headProp] >= this.world[this.queueProp].length) {
      this.world[this.queueProp] = this.world[this.queueProp].slice(this.world[this.headProp]);
      this.world[this.headProp] = 0;
      if (this.world[this.queueProp].length > 1) this.world[this.queueProp].sort((a, b) => a.dueTick - b.dueTick);
    }
  }
}
