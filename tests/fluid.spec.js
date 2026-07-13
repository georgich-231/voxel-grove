import { expect, test } from "@playwright/test";

function clearVolumeScript() {
  return `
    for (let x = -10; x <= 10; x += 1) {
      for (let z = -8; z <= 8; z += 1) {
        for (let y = 88; y <= 94; y += 1) {
          world.setBlock(x, y, z, 0, { skipWaterUpdate: true, skipLavaUpdate: true, skipLiquidInteractions: true });
        }
      }
    }
    world.waterQueue.length = 0;
    if (world.waterFlowPlanQueue) world.waterFlowPlanQueue.length = 0;
    world.lavaQueue.length = 0;
    world.waterQueueHead = 0;
    if (world.waterFlowPlanQueueHead !== undefined) world.waterFlowPlanQueueHead = 0;
    world.lavaQueueHead = 0;
    world.waterTick = 0;
    world.lavaTick = 0;
    world.waterQueued.clear();
    if (world.waterFlowPlanQueued) world.waterFlowPlanQueued.clear();
    world.lavaQueued.clear();
    if (world.modifiedWaterFalling) world.modifiedWaterFalling.clear();
  `;
}

test("water spread prefers the shortest path to a drop", async ({ page }) => {
  await page.goto("/");

  const flow = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    for (let x = -8; x <= 8; x += 1) {
      for (let z = -8; z <= 8; z += 1) {
        world.setBlock(x, 90, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
      }
    }
    world.setBlock(2, 90, 0, 0, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(0, 91, 0, 20, { waterLevel: 0, isSource: true });
    for (let tick = 0; tick < 5; tick += 1) world.stepWater(50);

    return {
      east: world.getBlock(1, 91, 0),
      west: world.getBlock(-1, 91, 0),
      north: world.getBlock(0, 91, -1),
      south: world.getBlock(0, 91, 1),
      eastLevel: world.getWaterLevel(1, 91, 0),
    };
  }, clearVolumeScript());

  expect(flow).toEqual({
    east: 20,
    west: 0,
    north: 0,
    south: 0,
    eastLevel: 1,
  });
});

test("water advances one block every five game ticks", async ({ page }) => {
  await page.goto("/");

  const timing = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    world.setBlock(6, 93, 0, 20, { waterLevel: 0, isSource: true });
    for (let tick = 0; tick < 4; tick += 1) world.stepWater(50);
    const beforeDelay = world.getBlock(6, 92, 0);

    world.stepWater(50);
    const afterFiveTicks = world.getBlock(6, 92, 0);
    const fallingIsSource = world.isWaterSourceAt(6, 92, 0);
    const secondBlockBeforeDelay = world.getBlock(6, 91, 0);

    for (let tick = 0; tick < 5; tick += 1) world.stepWater(50);
    const afterTenTicks = world.getBlock(6, 91, 0);

    return { beforeDelay, afterFiveTicks, fallingIsSource, secondBlockBeforeDelay, afterTenTicks };
  }, clearVolumeScript());

  expect(timing).toEqual({
    beforeDelay: 0,
    afterFiveTicks: 20,
    fallingIsSource: false,
    secondBlockBeforeDelay: 0,
    afterTenTicks: 20,
  });
});

test("water dries out after its source is removed", async ({ page }) => {
  await page.goto("/");

  const drying = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    for (let x = -2; x <= 8; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        world.setBlock(x, 89, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
      }
    }
    world.setBlock(2, 89, 0, 0, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(0, 90, 0, 20, { waterLevel: 0, isSource: true });

    for (let tick = 0; tick < 20; tick += 1) world.stepWater(100);
    const flowed = {
      side: world.getBlock(1, 90, 0),
      sideLevel: world.getWaterLevel(1, 90, 0),
      falling: world.getBlock(2, 89, 0),
      fallingLevel: world.getWaterLevel(2, 89, 0),
    };

    world.setBlock(0, 90, 0, 0);
    for (let tick = 0; tick < 30; tick += 1) world.stepWater(100);

    return {
      flowed,
      source: world.getBlock(0, 90, 0),
      side: world.getBlock(1, 90, 0),
      falling: world.getBlock(2, 89, 0),
    };
  }, clearVolumeScript());

  expect(drying).toEqual({
    flowed: {
      side: 20,
      sideLevel: 1,
      falling: 20,
      fallingLevel: 0,
    },
    source: 0,
    side: 0,
    falling: 0,
  });
});

test("ledge flow waits one fluid tick before creating its falling column", async ({ page }) => {
  await page.goto("/");

  const ledge = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        world.setBlock(x, 90, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
      }
    }
    world.setBlock(1, 90, 0, 0, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(0, 91, 0, 20, { waterLevel: 0, isSource: true });

    for (let tick = 0; tick < 5; tick += 1) world.stepWater(50);
    const beforeDrop = {
      lip: world.getBlock(1, 91, 0),
      lipHeight: world.waterSurfaceHeightAt(1, 91, 0),
      lipFalling: world.isWaterFallingAt(1, 91, 0),
      falling: world.getBlock(1, 90, 0),
      fallingLevel: world.getWaterLevel(1, 90, 0),
      fallingHeight: world.waterSurfaceHeightAt(1, 90, 0),
      fallingFlag: world.isWaterFallingAt(1, 90, 0),
    };

    for (let tick = 0; tick < 5; tick += 1) world.stepWater(50);

    return {
      beforeDrop,
      afterDrop: {
        lip: world.getBlock(1, 91, 0),
        lipHeight: world.waterSurfaceHeightAt(1, 91, 0),
        lipFalling: world.isWaterFallingAt(1, 91, 0),
        falling: world.getBlock(1, 90, 0),
        fallingLevel: world.getWaterLevel(1, 90, 0),
        fallingHeight: world.waterSurfaceHeightAt(1, 90, 0),
        fallingFlag: world.isWaterFallingAt(1, 90, 0),
      },
    };
  }, clearVolumeScript());

  expect(ledge).toEqual({
    beforeDrop: {
      lip: 20,
      lipHeight: 0.765625,
      lipFalling: false,
      falling: 0,
      fallingLevel: null,
      fallingHeight: null,
      fallingFlag: false,
    },
    afterDrop: {
      lip: 20,
      lipHeight: 0.765625,
      lipFalling: false,
      falling: 20,
      fallingLevel: 0,
      fallingHeight: 1,
      fallingFlag: true,
    },
  });
});

test("stair ledge lips do not become sideways spread sources", async ({ page }) => {
  await page.goto("/");

  const stair = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    for (let x = -2; x <= 9; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        world.setBlock(x, 89, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
        if (x <= 0) world.setBlock(x, 90, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
      }
    }
    world.setBlock(1, 90, 0, 0, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(0, 91, 0, 20, { waterLevel: 0, isSource: true });

    for (let tick = 0; tick < 45; tick += 1) world.stepWater(50);

    return {
      lip: world.getBlock(1, 91, 0),
      lipNorth: world.getBlock(1, 91, -1),
      lipSouth: world.getBlock(1, 91, 1),
      falling: world.getBlock(1, 90, 0),
      fallingLevel: world.getWaterLevel(1, 90, 0),
      lowerSpread: world.getBlock(2, 90, 0),
      lowerSpreadLevel: world.getWaterLevel(2, 90, 0),
      farSpread: world.getBlock(8, 90, 0),
      farSpreadLevel: world.getWaterLevel(8, 90, 0),
      tooFar: world.getBlock(9, 90, 0),
    };
  }, clearVolumeScript());

  expect(stair).toEqual({
    lip: 20,
    lipNorth: 0,
    lipSouth: 0,
    falling: 20,
    fallingLevel: 0,
    lowerSpread: 0,
    lowerSpreadLevel: null,
    farSpread: 0,
    farSpreadLevel: null,
    tooFar: 0,
  });
});

test("water render heights use thin last-flow levels and full falling sides", async ({ page }) => {
  await page.goto("/");

  const heights = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    world.setBlock(0, 89, 0, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(1, 89, 0, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
    world.setBlock(0, 90, 0, 20, { waterLevel: 0, isSource: true });
    world.setBlock(1, 90, 0, 20, { waterLevel: 7, isSource: false });
    world.setBlock(2, 90, 0, 20, { waterLevel: 0, isSource: false, waterFalling: true });

    return {
      source: world.waterSurfaceHeightAt(0, 90, 0),
      lastLevel: world.waterSurfaceHeightAt(1, 90, 0),
      falling: world.waterSurfaceHeightAt(2, 90, 0),
    };
  }, clearVolumeScript());

  expect(heights.source).toBeCloseTo(0.875, 5);
  expect(heights.lastLevel).toBeCloseTo(0.109375, 5);
  expect(heights.falling).toBe(1);
});

test("lava and water form Java-style reaction blocks", async ({ page }) => {
  await page.goto("/");

  const reactions = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    const lava = window.__gameDebug.getBlockIdByItemId("lava");
    const obsidian = window.__gameDebug.getBlockIdByItemId("obsidian");
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    world.setBlock(0, 90, 0, 20, { waterLevel: 0, isSource: true });
    world.setBlock(0, 91, 0, lava, { lavaLevel: 0, isSource: true });
    const lavaDownIntoWater = world.getBlock(0, 90, 0);

    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);
    world.setBlock(2, 90, 0, lava, { lavaLevel: 0, isSource: true });
    world.setBlock(2, 91, 0, 20, { waterLevel: 0, isSource: false });
    const waterDownIntoLavaSource = world.getBlock(2, 90, 0);

    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);
    world.setBlock(4, 90, 0, 20, { waterLevel: 0, isSource: false, skipLiquidInteractions: true });
    world.setLavaBlock(4, 90, 0, 2, { direction: [1, 0, 0] });
    const lavaSideIntoWater = world.getBlock(4, 90, 0);

    return {
      lava,
      obsidian,
      lavaDownIntoWater,
      waterDownIntoLavaSource,
      lavaSideIntoWater,
    };
  }, clearVolumeScript());

  expect(reactions.lava).toEqual(expect.any(Number));
  expect(reactions.obsidian).toEqual(expect.any(Number));
  expect(reactions.lavaDownIntoWater).toBe(3);
  expect(reactions.waterDownIntoLavaSource).toBe(reactions.obsidian);
  expect(reactions.lavaSideIntoWater).toBe(22);
});

test("lava bucket liquid uses slow lava ticks and renders as lava", async ({ page }) => {
  await page.goto("/");

  const lavaState = await page.evaluate((clearVolumeSource) => {
    const world = window.__game.world;
    const lava = window.__gameDebug.getBlockIdByItemId("lava");
    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);

    world.setBlock(0, 91, 0, lava, { lavaLevel: 0, isSource: true });
    for (let tick = 0; tick < 29; tick += 1) world.stepLava(50);
    const beforeDelay = {
      below: world.getBlock(0, 90, 0),
      belowLevel: world.getLavaLevel(0, 90, 0),
      belowFalling: world.isLavaFallingAt(0, 90, 0),
    };

    world.stepLava(50);
    world.ensureChunksAround({ x: 0, z: 0 }, 1, 9, { timeBudgetMs: 50 });

    const chunk = world.chunks.get(world.key(0, 0));
    chunk.rebuildMesh();
    const vertical = {
      source: world.getBlock(0, 91, 0),
      below: world.getBlock(0, 90, 0),
      belowLevel: world.getLavaLevel(0, 90, 0),
      belowFalling: world.isLavaFallingAt(0, 90, 0),
      belowSurface: world.lavaSurfaceHeightAt(0, 90, 0),
      lavaMesh: Boolean(chunk.lavaMesh),
      lavaUsesOwnMaterial: chunk.lavaMesh?.material !== chunk.waterMesh?.material,
      textureWidth: chunk.lavaMesh?.material.map.image.width,
    };

    // eslint-disable-next-line no-new-func
    new Function("world", clearVolumeSource)(world);
    for (let x = -4; x <= 4; x += 1) {
      for (let z = -4; z <= 4; z += 1) {
        world.setBlock(x, 89, z, 3, { skipWaterUpdate: true, skipLavaUpdate: true });
      }
    }
    world.setBlock(0, 90, 0, lava, { lavaLevel: 0, isSource: true });
    const horizontal = [];
    for (let tick = 0; tick <= 90; tick += 1) {
      if (tick > 0) world.stepLava(50);
      if (tick === 30 || tick === 60 || tick === 90) {
        horizontal.push([1, 2, 3, 4].map((x) => [world.getBlock(x, 90, 0), world.getLavaLevel(x, 90, 0)]));
      }
    }

    return {
      lava,
      beforeDelay,
      vertical,
      horizontal,
    };
  }, clearVolumeScript());

  expect(lavaState.beforeDelay).toEqual({
    below: 0,
    belowLevel: null,
    belowFalling: false,
  });
  expect(lavaState.vertical.source).toBe(lavaState.lava);
  expect(lavaState.vertical.below).toBe(lavaState.lava);
  expect(lavaState.vertical.belowLevel).toBe(0);
  expect(lavaState.vertical.belowFalling).toBe(true);
  expect(lavaState.vertical.belowSurface).toBe(1);
  expect(lavaState.vertical.lavaMesh).toBe(true);
  expect(lavaState.vertical.lavaUsesOwnMaterial).toBe(true);
  expect(lavaState.vertical.textureWidth).toBe(16);
  expect(lavaState.horizontal).toEqual([
    [
      [lavaState.lava, 2],
      [0, null],
      [0, null],
      [0, null],
    ],
    [
      [lavaState.lava, 2],
      [lavaState.lava, 4],
      [0, null],
      [0, null],
    ],
    [
      [lavaState.lava, 2],
      [lavaState.lava, 4],
      [lavaState.lava, 6],
      [0, null],
    ],
  ]);
});
