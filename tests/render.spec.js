import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", size: { width: 1280, height: 720 } },
  { name: "mobile", size: { width: 390, height: 844 } },
];

async function startGame(page) {
  await openCreateWorld(page);
  await page.getByRole("button", { name: /start world/i }).click();
  await expect.poll(() => page.evaluate(() => window.__game.started), { timeout: 45000 }).toBe(true);
}

async function openCreateWorld(page) {
  if (await page.locator(".world-create-window").isHidden()) {
    await page.getByRole("button", { name: /play/i }).click();
  }
  await expect(page.locator(".world-create-window")).toBeVisible();
}

function hexLuminance(hex) {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

for (const viewport of VIEWPORTS) {
  test(`renders title screen and voxel scene on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport.size);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /voxel grove/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
    await openCreateWorld(page);
    await expect(page.getByRole("button", { name: /survival/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /creative/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /spectator/i })).toBeHidden();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return false;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      return Boolean(gl);
    });

    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
        if (!canvas || !gl) return false;
        const width = Math.max(1, canvas.width);
        const height = Math.max(1, canvas.height);
        const sample = new Uint8Array(4 * 5);
        const points = [
          [0.25, 0.25],
          [0.5, 0.35],
          [0.75, 0.45],
          [0.35, 0.65],
          [0.65, 0.75],
        ];
        const unique = new Set();

        points.forEach(([x, y], index) => {
          gl.readPixels(
            Math.floor(width * x),
            Math.floor(height * y),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            sample,
            index * 4,
          );
          const offset = index * 4;
          unique.add(`${sample[offset]},${sample[offset + 1]},${sample[offset + 2]},${sample[offset + 3]}`);
        });

        return unique.size > 1;
      },
      undefined,
      { timeout: 10000 },
    );

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${viewport.name}-title-screen`, {
      body: screenshot,
      contentType: "image/png",
    });
    expect(screenshot.length).toBeGreaterThan(1000);

    const pixels = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const sample = new Uint8Array(4 * 9);
      const points = [
        [0.25, 0.25],
        [0.5, 0.25],
        [0.75, 0.25],
        [0.25, 0.5],
        [0.5, 0.5],
        [0.75, 0.5],
        [0.25, 0.75],
        [0.5, 0.75],
        [0.75, 0.75],
      ];

      points.forEach(([x, y], index) => {
        gl.readPixels(
          Math.floor(width * x),
          Math.floor(height * y),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sample,
          index * 4,
        );
      });

      return Array.from(sample);
    });

    const unique = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
    }

    expect(unique.size).toBeGreaterThan(1);
  });
}

test("starts creative mode and toggles flight with double space", async ({ page }) => {
  test.setTimeout(50000);
  await page.goto("/");
  await openCreateWorld(page);
  await page.getByRole("button", { name: /creative/i }).click();
  await startGame(page);

  await page.keyboard.press("Space");
  await page.waitForTimeout(80);
  await page.keyboard.press("Space");

  await expect(page.locator(".world-status")).toContainText(/Creative Fly/, { timeout: 3000 });
  await expect.poll(() => page.evaluate(() => (
    window.__game.inventory.slots.slice(27, 36).every((slot) => slot === null)
  ))).toBe(true);
});

test("shows coordinates and enables spectator night vision", async ({ page }) => {
  test.setTimeout(45000);
  await page.goto("/");
  await startGame(page);

  const debug = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(12.8, 96.2, -34.1);
    game.updateCoordinatesStatus();
    const before = game.world.material.emissiveIntensity;
    const darkLightBefore = window.__gameDebug.getMinecraftLightFactor(0);
    game.setPlayerMode("spectator");
    game.applyVisionMode();

    return {
      coordinates: document.querySelector(".coordinates-status").textContent,
      mode: game.player.mode,
      flying: game.player.isFlying,
      before,
      after: game.world.material.emissiveIntensity,
      fullBrightLighting: window.__gameDebug.isFullBrightLighting(),
      darkLightBefore,
      darkLightAfter: window.__gameDebug.getMinecraftLightFactor(0),
      fogNear: game.scene.fog.near,
      fogFar: game.scene.fog.far,
      edgeFog: window.__gameDebug.getSkyMaterialState().fogEdgeEnabled,
      maxBuildY: window.__gameDebug.getMaxBuildY(),
      seaLevel: window.__gameDebug.getSeaLevel(),
    };
  });

  expect(debug).toEqual(expect.objectContaining({
    coordinates: "XYZ: 12 / 96 / -35",
    mode: "spectator",
    flying: true,
    fullBrightLighting: true,
    maxBuildY: 319,
    seaLevel: 63,
  }));
  expect(debug.before).toBe(0);
  expect(debug.after).toBe(0);
  expect(debug.darkLightBefore).toBeLessThan(0.25);
  expect(debug.darkLightAfter).toBe(1);
  expect(debug.fogNear).toBeGreaterThan(70);
  expect(debug.fogFar).toBeGreaterThan(debug.fogNear);
  expect(debug.edgeFog).toBe(1);
});

test("uses radial clear-weather fog before the loaded-world edge", async ({ page }) => {
  test.setTimeout(70000);
  await page.goto("/");
  await startGame(page);

  const fog = await page.evaluate(() => {
    const game = window.__game;
    game.setWeather("clear", 300, false);
    game.setRenderDistance(8);
    game.updateFogForView();
    return {
      near: game.scene.fog.near,
      far: game.scene.fog.far,
      chunkReach: game.renderDistance * 16,
      color: game.scene.fog.color.getHex(),
      edge: window.__gameDebug.getSkyMaterialState(),
      playerChunk: [
        Math.floor(game.player.position.x / 16),
        Math.floor(game.player.position.z / 16),
      ],
    };
  });

  expect(fog.near / fog.far).toBeGreaterThan(0.68);
  expect(fog.near / fog.far).toBeLessThan(0.76);
  expect(fog.near).toBeLessThan(fog.far);
  expect(fog.far - fog.near).toBeGreaterThan(30);
  expect(fog.far).toBeLessThan(fog.chunkReach);
  expect(fog.far).toBeGreaterThan(fog.chunkReach - 16);
  expect(fog.color).toEqual(expect.any(Number));
  expect(fog.edge.fogEdgeEnabled).toBe(1);
  expect(fog.edge.fogEdgeWidth).toBeGreaterThanOrEqual(32);
  expect(fog.edge.fogEdgeBounds).toEqual([
    (fog.playerChunk[0] - 8) * 16,
    (fog.playerChunk[1] - 8) * 16,
    (fog.playerChunk[0] + 9) * 16,
    (fog.playerChunk[1] + 9) * 16,
  ]);
});

test("uses multisample antialiasing with SMAA instead of a blur pass", async ({ page }) => {
  await page.goto("/");

  const antialiasing = await page.evaluate(() => {
    const game = window.__game;
    game.setAntialiasing(true);
    const enabled = {
      maxSamples: game.renderer.capabilities.maxSamples,
      targetSamples: game.composer.renderTarget1.samples,
      smaa: game.smaaPass.enabled,
      hasLegacyBlur: Boolean(game.edgeSmoothingPass),
    };

    game.setAntialiasing(false);
    const disabled = {
      targetSamples: game.composer.renderTarget1.samples,
      smaa: game.smaaPass.enabled,
    };

    return { enabled, disabled };
  });

  expect(antialiasing.enabled.targetSamples).toBe(Math.min(2, antialiasing.enabled.maxSamples));
  expect(antialiasing.enabled.smaa).toBe(true);
  expect(antialiasing.enabled.hasLegacyBlur).toBe(false);
  expect(antialiasing.disabled.targetSamples).toBe(0);
  expect(antialiasing.disabled.smaa).toBe(false);
});

test("uses textured sky, weather commands, snow conditions, and camera-following clouds", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await startGame(page);

  await expect.poll(
    () => page.evaluate(() => Object.values(window.__gameDebug.getEnvironmentTextureStatus()).every(Boolean)),
    { timeout: 10000 },
  ).toBe(true);

  const sky = await page.evaluate(() => {
    const game = window.__game;
    game.allowCheats = true;
    game.executeChatCommand("time set night");
    game.updateSkyCycle(0);
    const clearNight = {
      background: game.scene.background.getHex(),
      horizon: game.skyMaterial.uniforms.horizonColor.value.getHex(),
      fog: game.scene.fog.color.getHex(),
      cloud: game.cloudMaterial.color.getHex(),
      cloudEmissive: game.cloudMaterial.emissive.getHex(),
    };
    game.executeChatCommand("weather rain 60");
    game.updateSkyCycle(0);
    game.updatePrecipitation(0);
    const rainNight = {
      background: game.scene.background.getHex(),
      horizon: game.skyMaterial.uniforms.horizonColor.value.getHex(),
      fog: game.scene.fog.color.getHex(),
      cloud: game.cloudMaterial.color.getHex(),
      cloudEmissive: game.cloudMaterial.emissive.getHex(),
    };

    const rainVisible = game.rainGroup.visible;
    const cloudBefore = game.clouds.position.clone();
    game.camera.position.set(1200, 150, -900);
    game.updateClouds(0);
    const cloudAfter = game.clouds.position.clone();
    const nearestCloudDistance = Math.min(...game.clouds.children.map((cloud) => {
      const worldX = game.clouds.position.x + cloud.position.x;
      const worldZ = game.clouds.position.z + cloud.position.z;
      return Math.max(Math.abs(worldX - 1200), Math.abs(worldZ + 900));
    }));

    let cold = null;
    for (let z = -2048; z <= 2048 && !cold; z += 16) {
      for (let x = -2048; x <= 2048; x += 16) {
        if (!game.isSnowingAt(x, z)) continue;
        cold = { x, z, biome: game.world.biomeAt(x, z) };
        break;
      }
    }

    if (cold) {
      game.player.position.set(cold.x, 90, cold.z);
      game.camera.position.copy(game.player.position);
      game.updatePrecipitation(0);
    }

    return {
      time: window.__gameDebug.getTimeOfDay(),
      weather: window.__gameDebug.getWeather(),
      sunOpacity: game.sunSprite.material.opacity,
      sunCanvasCutout: game.sunSprite.material.map.image instanceof HTMLCanvasElement,
      moonOpacity: game.moonSprite.material.opacity,
      moonCanvasCutout: game.moonSprite.material.map.image instanceof HTMLCanvasElement,
      clearNight,
      rainNight,
      rainVisible,
      snowVisible: game.snowGroup.visible,
      cold,
      cloudDelta: Math.abs(cloudAfter.x - cloudBefore.x) + Math.abs(cloudAfter.z - cloudBefore.z),
      cloudCameraDistance: nearestCloudDistance,
      cloudHeight: game.clouds.position.y,
      skyMaterial: window.__gameDebug.getSkyMaterialState(),
    };
  });

  expect(sky.time).toBe(13000);
  expect(sky.weather).toBe("rain");
  expect(sky.sunOpacity).toBeLessThan(0.1);
  expect(sky.sunCanvasCutout).toBe(true);
  expect(sky.skyMaterial.sunSize).toBeGreaterThan(36);
  expect(sky.moonOpacity).toBeGreaterThan(0.1);
  expect(sky.moonCanvasCutout).toBe(true);
  expect(hexLuminance(sky.rainNight.horizon)).toBeLessThanOrEqual(hexLuminance(sky.clearNight.horizon) + 0.01);
  expect(hexLuminance(sky.rainNight.fog)).toBeLessThanOrEqual(hexLuminance(sky.clearNight.fog) + 0.01);
  expect(hexLuminance(sky.rainNight.cloud)).toBeLessThan(hexLuminance(sky.clearNight.cloud));
  expect(hexLuminance(sky.rainNight.cloudEmissive)).toBeLessThan(hexLuminance(sky.clearNight.cloudEmissive));
  expect(sky.rainVisible).toBe(true);
  expect(sky.cold).toEqual(expect.objectContaining({ biome: expect.any(String) }));
  expect(sky.snowVisible).toBe(true);
  expect(sky.cloudCameraDistance).toBeLessThan(170);
  expect(sky.cloudHeight).toBeGreaterThan(150);
  expect(sky.skyMaterial.cloudTileSize).toBeLessThan(180);
  expect(sky.skyMaterial.cloudPuffCount).toBeGreaterThan(120);
  expect(sky.skyMaterial.cloudPuffCount).toBeLessThan(260);
  expect(sky.skyMaterial.cloudOverlapCount).toBe(0);
  expect(sky.skyMaterial.cloudMaterialType).toBe("MeshLambertMaterial");
  expect(sky.skyMaterial.blockAtlasMipmapSafe).toBe(true);
  expect(sky.skyMaterial.sunDepthTest).toBe(true);
  expect(sky.skyMaterial.moonDepthTest).toBe(true);
  expect(sky.skyMaterial.sunRenderOrder).toBeGreaterThanOrEqual(-1);
  expect(sky.skyMaterial.shadowFar).toBeGreaterThanOrEqual(240);
  expect(sky.skyMaterial.shadowNormalBias).toBeGreaterThan(0);
  expect(sky.skyMaterial.rainParticles).toBeGreaterThan(700);
  expect(sky.skyMaterial.rainMaterialType).toBe("MeshBasicMaterial");
  expect(sky.skyMaterial.rainTextureWrapT).toBe(1000);
  expect(sky.skyMaterial.rainOpacity).toBeGreaterThan(0.2);
  expect(sky.skyMaterial.rainOpacity).toBeLessThan(0.6);
  expect(sky.skyMaterial.rainHeight).toBeGreaterThan(15);
  expect(sky.skyMaterial.leafTransparent).toBe(false);
  expect(sky.skyMaterial.leafOpacity).toBe(1);
  expect(sky.skyMaterial.leafDepthWrite).toBe(true);
  expect(sky.skyMaterial.leafAlphaTest).toBe(0);
});

test("opens pause menu and changes render distance from settings", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await startGame(page);
  await page.keyboard.press("Escape");

  await expect(page.locator(".pause-overlay")).toBeVisible();
  await expect(page.getByRole("heading", { name: /paused/i })).toBeVisible();

  await page.getByRole("button", { name: /settings/i }).click();
  await page.locator(".render-distance-input").evaluate((input) => {
    input.value = "6";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator(".render-distance-value")).toContainText("6 chunks");
  await expect.poll(() => page.evaluate(() => window.__game.renderDistance)).toBe(6);
  await expect(page.locator(".render-distance-input")).toHaveAttribute("max", "32");

  await page.locator(".settings-close-button").click();
  await page.getByRole("button", { name: /title screen/i }).click();
  await expect(page.locator(".title-screen")).toBeVisible();
});

test("opens full settings from the title screen", async ({ page }) => {
  await page.goto("/");

  await page.locator(".title-settings-button").click();

  await expect(page.locator(".settings-overlay")).toBeVisible();
  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  await expect(page.locator(".render-distance-input")).toHaveAttribute("max", "32");

  const settings = await page.evaluate(() => ({
    titleRenderDistance: window.__gameDebug.getTitleRenderDistance(),
    maxRenderDistance: window.__gameDebug.getMaxRenderDistance(),
    resolution: document.querySelector(".resolution-select")?.value,
    fov: Boolean(document.querySelector(".fov-input")),
    sensitivity: Boolean(document.querySelector(".sensitivity-input")),
    smoothLighting: Boolean(document.querySelector(".smooth-lighting-input")),
    shadows: Boolean(document.querySelector(".shadow-input")),
    clouds: Boolean(document.querySelector(".cloud-input")),
    chunks: window.__game.world.chunks.size,
  }));

  expect(settings).toMatchObject({
    titleRenderDistance: 5,
    maxRenderDistance: 32,
    resolution: "1280x720",
    fov: true,
    sensitivity: true,
    smoothLighting: true,
    shadows: true,
    clouds: true,
  });
  expect(settings.chunks).toBeGreaterThan(100);
});

test("remembers graphics settings and resolution choice", async ({ page }) => {
  await page.goto("/");
  await page.locator(".title-settings-button").click();

  await page.locator(".resolution-select").selectOption("1600x900");
  await page.locator(".render-distance-input").evaluate((input) => {
    input.value = "7";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".fov-input").evaluate((input) => {
    input.value = "80";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".sensitivity-input").evaluate((input) => {
    input.value = "125";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".shadow-input").setChecked(false);
  await page.locator(".cloud-input").setChecked(false);

  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("voxel-grove.graphics-settings.v1"));
    return settings;
  })).toMatchObject({
    resolutionPreset: "1600x900",
    renderDistance: 7,
    fieldOfView: 80,
    mouseSensitivity: 1.25,
    shadows: false,
    clouds: false,
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: /voxel grove/i })).toBeVisible();
  await page.locator(".title-settings-button").click();

  await expect(page.locator(".resolution-select")).toHaveValue("1600x900");
  await expect(page.locator(".resolution-value")).toContainText("1600 x 900");
  await expect(page.locator(".render-distance-value")).toContainText("7 chunks");
  await expect(page.locator(".fov-value")).toContainText("80");
  await expect(page.locator(".sensitivity-value")).toContainText("125%");
  await expect(page.locator(".shadow-input")).not.toBeChecked();
  await expect(page.locator(".cloud-input")).not.toBeChecked();
});

test("starts once the visible spawn area is ready and streams the outer ring", async ({ page }) => {
  test.setTimeout(50000);
  await page.goto("/");

  await openCreateWorld(page);
  await page.getByRole("button", { name: /start world/i }).evaluate((button) => button.click());
  await expect(page.locator(".loading-overlay")).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__game.started), { timeout: 45000 }).toBe(true);

  const loading = await page.evaluate(() => {
    const game = window.__game;
    const outerStats = game.world.chunkBuildStats(game.player.position, 6);
    const nearStats = game.world.chunkGeneratedStats(game.player.position, 1);
    const centerStats = game.world.chunkBuildStats(game.player.position, 0);
    return {
      hidden: document.querySelector(".loading-overlay").hidden,
      near: nearStats,
      center: centerStats,
      outerReady: outerStats.ready,
      outerTotal: outerStats.total,
      generationWorkersDisabled: game.world.generationWorkerPool.disabled,
      meshWorkersDisabled: game.world.meshWorkerPool.disabled,
    };
  });

  expect(loading.hidden).toBe(true);
  expect(loading.near).toEqual({ ready: 9, total: 9 });
  expect(loading.center).toEqual({ ready: 1, total: 1 });
  expect(loading.outerReady).toBeLessThan(loading.outerTotal);
  expect(loading.generationWorkersDisabled).toBe(false);
  expect(loading.meshWorkersDisabled).toBe(false);
});

test("reprioritizes chunk streaming immediately after fast travel", async ({ page }) => {
  test.setTimeout(50000);
  await page.goto("/");
  await startGame(page);

  await page.evaluate(() => {
    const game = window.__game;
    game.player.position.x += 16 * 12;
    game.player.position.z += 16 * 9;
    game.player.velocity.set(24, 0, 18);
    game.player.update(0);
  });

  await expect.poll(() => page.evaluate(() => {
    const game = window.__game;
    const cx = Math.floor(game.player.position.x / 16);
    const cz = Math.floor(game.player.position.z / 16);
    const chunk = game.world.chunks.get(game.world.key(cx, cz));
    return Boolean(chunk?.generated && (chunk.mesh || chunk.waterMesh));
  }), { timeout: 12000 }).toBe(true);

  const streaming = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    const pcx = Math.floor(game.player.position.x / 16);
    const pcz = Math.floor(game.player.position.z / 16);
    const maxQueuedDistance = world.generationWorkerPool.queue.reduce((maximum, task) => (
      Math.max(maximum, Math.max(Math.abs(task.cx - pcx), Math.abs(task.cz - pcz)))
    ), 0);
    return {
      generationWorkersDisabled: world.generationWorkerPool.disabled,
      meshWorkersDisabled: world.meshWorkerPool.disabled,
      generationWorkers: world.generationWorkerPool.workers.length,
      meshWorkers: world.meshWorkerPool.workers.length,
      maxQueuedDistance,
    };
  });

  expect(streaming).toEqual(expect.objectContaining({
    generationWorkersDisabled: false,
    meshWorkersDisabled: false,
  }));
  expect(streaming.generationWorkers).toBeGreaterThanOrEqual(1);
  expect(streaming.meshWorkers).toBeGreaterThanOrEqual(1);
  expect(streaming.maxQueuedDistance).toBeLessThanOrEqual(17);
});

test("keeps first chunk meshes visible while full detail streams", async ({ page }) => {
  test.setTimeout(80000);
  await page.goto("/");
  await startGame(page);

  await expect.poll(() => page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    const pcx = Math.floor(game.player.position.x / 16);
    const pcz = Math.floor(game.player.position.z / 16);
    let generated = 0;
    let missingMeshes = 0;

    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        const chunk = world.chunks.get(world.key(pcx + dx, pcz + dz));
        if (!chunk?.generated) continue;
        generated += 1;
        if (!chunk.mesh && !chunk.leafMesh && !chunk.torchMesh && !chunk.waterMesh && !chunk.lavaMesh) {
          missingMeshes += 1;
        }
      }
    }

    return { generated, missingMeshes };
  }), { timeout: 45000 }).toEqual({ generated: 25, missingMeshes: 0 });
});

test("renders ocean floors in first-pass surface chunk meshes", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await openCreateWorld(page);
  await page.locator(".seed-input").fill("4095200884");
  await page.getByRole("button", { name: /start world/i }).click();
  await expect.poll(() => page.evaluate(() => window.__game.started), { timeout: 45000 }).toBe(true);

  const ocean = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;

    const inspectChunk = (cx, cz) => {
      let deepWaterColumns = 0;
      for (let x = 2; x < 16; x += 4) {
        for (let z = 2; z < 16; z += 4) {
          const wx = cx * 16 + x;
          const wz = cz * 16 + z;
          const height = world.terrainHeight(wx, wz);
          const shape = world.terrainShapeAt(wx, wz);
          if (world.isNaturalWaterColumn(shape, height) && height <= 58) deepWaterColumns += 1;
        }
      }
      return deepWaterColumns;
    };

    // Find a deep-ocean sample inside the active render ring but outside the
    // full-detail radius. A farther fixed chunk is correctly pruned by the
    // streamer while its mesh is queued, which made this test chase a chunk
    // that no longer existed rather than testing first-pass ocean meshing.
    const pcx = Math.floor(game.player.position.x / 16);
    const pcz = Math.floor(game.player.position.z / 16);
    for (let radius = 4; radius <= game.renderDistance; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const deepWaterColumns = inspectChunk(cx, cz);
          if (deepWaterColumns < 10) continue;
          window.__testOceanChunk = { cx, cz };
          return { cx, cz, deepWaterColumns };
        }
      }
    }
    return null;
  });

  expect(ocean).not.toBeNull();

  await expect.poll(() => page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    const { cx, cz } = window.__testOceanChunk;
    const chunk = world.getChunk(cx, cz, { detail: "surface" });

    if (!chunk.mesh && !chunk.meshPending && chunk.dirty) {
      world.meshWorkerPool.schedule(chunk, -1000000);
    }

    return {
      detail: chunk.generationDetail,
      dirty: chunk.dirty,
      pending: chunk.meshPending,
      hasTerrainMesh: Boolean(chunk.mesh),
      hasWaterMesh: Boolean(chunk.waterMesh),
      terrainVertices: chunk.mesh?.geometry.getAttribute("position")?.count ?? 0,
      waterVertices: chunk.waterMesh?.geometry.getAttribute("position")?.count ?? 0,
    };
  }), { timeout: 45000 }).toEqual(expect.objectContaining({
    detail: "surface",
    dirty: false,
    pending: false,
    hasTerrainMesh: true,
    hasWaterMesh: true,
  }));
});

test("keeps terrain faces below tree canopies in first-pass surface meshes", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await openCreateWorld(page);
  await page.locator(".seed-input").fill("4095200884");
  await page.getByRole("button", { name: /start world/i }).click();
  await expect.poll(() => page.evaluate(() => window.__game.started), { timeout: 45000 }).toBe(true);

  const target = await page.evaluate(() => {
    const world = window.__game.world;
    for (let radius = 12; radius <= 48; radius += 1) {
      for (let cz = -radius; cz <= radius; cz += 1) {
        for (let cx = -radius; cx <= radius; cx += 1) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
          for (let lz = 5; lz <= 10; lz += 1) {
            for (let lx = 5; lx <= 10; lx += 1) {
              const wx = cx * 16 + lx;
              const wz = cz * 16 + lz;
              if (!world.generator.treeTypeAt(wx, wz)) continue;
              window.__testTreeSurfaceChunk = { cx, cz };
              return { cx, cz };
            }
          }
        }
      }
    }
    return null;
  });

  expect(target).not.toBeNull();

  await expect.poll(() => page.evaluate(() => {
    const world = window.__game.world;
    const { cx, cz } = window.__testTreeSurfaceChunk;
    const chunk = world.getChunk(cx, cz, { detail: "surface" });
    if (!chunk?.generated) return { ready: false };

    const leafBlocks = new Set([6, 16, 18, 34, 41, 66]);
    let coveredGround = null;
    for (let lz = 1; lz < 15 && !coveredGround; lz += 1) {
      for (let lx = 1; lx < 15 && !coveredGround; lx += 1) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const groundY = world.terrainHeight(wx, wz);
        if (chunk.getLocal(lx, groundY + 1, lz) !== 0) continue;
        for (let y = groundY + 2; y <= Math.min(groundY + 14, 319); y += 1) {
          if (!leafBlocks.has(chunk.getLocal(lx, y, lz))) continue;
          coveredGround = { wx, wz, groundY };
          break;
        }
      }
    }
    if (!coveredGround) return { ready: false, generated: true, coveredGround: false };

    if (!chunk.mesh && !chunk.meshPending && chunk.dirty) {
      world.meshWorkerPool.schedule(chunk, -1000000);
    }
    if (!chunk.mesh || chunk.meshPending || chunk.dirty) {
      return { ready: false, generated: true, coveredGround: true };
    }

    const positions = chunk.mesh.geometry.getAttribute("position");
    const normals = chunk.mesh.geometry.getAttribute("normal");
    let topVertices = 0;
    for (let index = 0; index < positions.count; index += 1) {
      if (normals.getY(index) < 0.99) continue;
      if (Math.abs(positions.getY(index) - (coveredGround.groundY + 1)) > 0.001) continue;
      if (positions.getX(index) < coveredGround.wx || positions.getX(index) > coveredGround.wx + 1) continue;
      if (positions.getZ(index) < coveredGround.wz || positions.getZ(index) > coveredGround.wz + 1) continue;
      topVertices += 1;
    }

    return {
      ready: true,
      detail: chunk.generationDetail,
      coveredGround,
      topVertices,
      hasCompleteTopFace: topVertices >= 4,
    };
  }), { timeout: 25000 }).toEqual(expect.objectContaining({
    ready: true,
    detail: "surface",
    hasCompleteTopFace: true,
  }));
});

test("starts the player on a dry clear ground column", async ({ page }) => {
  test.setTimeout(50000);
  await page.goto("/");
  await startGame(page);

  const spawn = await page.evaluate(() => {
    const game = window.__game;
    const x = Math.floor(game.player.position.x);
    const y = Math.floor(game.player.position.y);
    const z = Math.floor(game.player.position.z);
    const unsafeGround = new Set([5, 6, 15, 16, 17, 18, 33, 34, 40, 41, 19, 10]);
    let nearbyTrees = 0;
    let nearbyRocks = 0;
    let nearbyCacti = 0;
    for (let dz = -3; dz <= 3; dz += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (game.world.treeTypeAt(x + dx, z + dz)) nearbyTrees += 1;
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && game.world.rockTypeAt(x + dx, z + dz)) nearbyRocks += 1;
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && game.world.shouldGrowCactus(x + dx, z + dz)) nearbyCacti += 1;
      }
    }

    return {
      ground: game.world.getBlock(x, y - 1, z),
      feet: game.world.getBlock(x, y, z),
      head: game.world.getBlock(x, y + 1, z),
      aboveHead: game.world.getBlock(x, y + 2, z),
      feetWater: game.world.getBlock(x, y, z) === 20,
      headWater: game.world.getBlock(x, y + 1, z) === 20,
      unsafeGround: unsafeGround.has(game.world.getBlock(x, y - 1, z)),
      nearbyTrees,
      nearbyRocks,
      nearbyCacti,
      plant: game.world.plantTypeAt(x, z),
      caveMouth: game.world.surfaceCaveMouthStrength(x, z, y - 1),
    };
  });

  expect(spawn.ground).not.toBe(0);
  expect(spawn.feet).toBe(0);
  expect(spawn.head).toBe(0);
  expect(spawn.aboveHead).toBe(0);
  expect(spawn.feetWater).toBe(false);
  expect(spawn.headWater).toBe(false);
  expect(spawn.unsafeGround).toBe(false);
  expect(spawn.nearbyTrees).toBe(0);
  expect(spawn.nearbyRocks).toBe(0);
  expect(spawn.nearbyCacti).toBe(0);
  expect(spawn.plant).toBeNull();
  expect(spawn.caveMouth).toBeLessThanOrEqual(0.12);
});

test("opens inventory and crafts starter 2x2 recipes", async ({ page }) => {
  test.setTimeout(70000);
  await page.goto("/");
  await startGame(page);
  await page.keyboard.press("KeyE");
  await expect(page.locator(".inventory-overlay")).toBeVisible();

  await page.evaluate(() => {
    window.__game.inventory.addItem("log", 1);
    window.__game.renderInventory();
  });

  await page.locator('[data-area="inventory"][data-index="27"]').click();
  await page.locator('[data-area="craft"][data-index="0"]').click();
  await page.locator(".craft-output .output-slot").click();

  await expect.poll(async () => {
    return page.evaluate(() => window.__game.inventory.cursor);
  }).toEqual({ id: "planks_oak", count: 4 });

  const recipeResults = await page.evaluate(() => {
    const game = window.__game;
    game.inventory.cursor = null;

    game.inventory.craftSlots = [
      { id: "plank", count: 1 },
      null,
      { id: "plank", count: 1 },
      null,
    ];
    game.takeCraftingOutput();
    const sticks = game.inventory.cursor;

    game.inventory.cursor = null;
    game.inventory.craftSlots = [
      { id: "plank", count: 1 },
      { id: "plank", count: 1 },
      { id: "plank", count: 1 },
      { id: "plank", count: 1 },
    ];
    game.takeCraftingOutput();
    const table = game.inventory.cursor;

    return { sticks, table };
  });

  expect(recipeResults).toEqual({
    sticks: { id: "stick", count: 4 },
    table: { id: "crafting_table", count: 1 },
  });

  await page.evaluate(() => {
    const game = window.__game;
    game.inventory = new game.inventory.constructor();
    game.inventory.craftSlots = [
      { id: "plank", count: 3 },
      null,
      { id: "plank", count: 3 },
      null,
    ];
    game.renderInventory();
  });

  await page.locator(".craft-output .output-slot").click({ modifiers: ["Shift"] });

  await expect.poll(() => page.evaluate(() => ({
    hotbarSlot: window.__game.inventory.slots[27],
    craftSlots: window.__game.inventory.craftSlots,
  }))).toEqual({
    hotbarSlot: { id: "stick", count: 12 },
    craftSlots: [null, null, null, null],
  });
});

test("recipe guide autofills crafting grids and inventory drop macros work", async ({ page }) => {
  test.setTimeout(70000);
  await page.goto("/");
  await page.evaluate(() => {
    const game = window.__game;
    game.started = true;
    game.openInventory();
  });
  await expect(page.locator(".inventory-overlay")).toBeVisible();

  await page.evaluate(() => {
    const game = window.__game;
    game.inventory = new game.inventory.constructor();
    game.inventory.slots[0] = { id: "log", count: 1 };
    game.renderInventory();
  });

  const recipeSearch2x2 = page.locator(".recipe-search-input-2x2");
  await recipeSearch2x2.fill("torch");
  await expect(page.locator('[data-recipe-id="guide_planks_oak"]')).toHaveCount(0);
  await expect(page.locator('[data-recipe-id="guide_torch_coal"]')).toHaveCount(1);
  await recipeSearch2x2.focus();
  await page.keyboard.type("e");
  await expect(page.locator(".inventory-overlay")).toBeVisible();
  await recipeSearch2x2.fill("");

  await page.locator('[data-recipe-id="guide_planks_oak"]').click();
  await expect.poll(() => page.evaluate(() => ({
    craftSlots: window.__game.inventory.craftSlots,
    output: window.__game.inventory.cursor,
    result: window.__gameDebug.getCraftingResult(window.__game.inventory.craftSlots),
  }))).toMatchObject({
    craftSlots: [{ id: "log", count: 1 }, null, null, null],
    output: null,
    result: { id: "planks_oak", count: 4 },
  });

  await page.locator(".craft-output .output-slot").click();
  await expect.poll(() => page.evaluate(() => window.__game.inventory.cursor)).toEqual({ id: "planks_oak", count: 4 });

  await page.evaluate(() => {
    const game = window.__game;
    game.inventory = new game.inventory.constructor();
    game.inventory.slots[0] = { id: "planks_oak", count: 3 };
    game.inventory.slots[1] = { id: "stick", count: 2 };
    game.inventoryOpen = false;
    game.inventoryOverlay.hidden = true;
    game.openCraftingTable();
  });

  await expect(page.locator(".crafting-table-overlay")).toBeVisible();
  const recipeSearch3x3 = page.locator(".recipe-search-input-3x3");
  await recipeSearch3x3.fill("pickaxe");
  await expect(page.locator('[data-recipe-id="guide_table_0_wood_pickaxe"]')).toHaveCount(1);
  await page.locator('[data-recipe-id="guide_table_0_wood_pickaxe"]').click();
  await expect.poll(() => page.evaluate(() => ({
    tableSlots: window.__game.inventory.tableSlots,
    result: window.__gameDebug.getCraftingResult3x3(window.__game.inventory.tableSlots),
  }))).toMatchObject({
    tableSlots: [
      { id: "planks_oak", count: 1 },
      { id: "planks_oak", count: 1 },
      { id: "planks_oak", count: 1 },
      null,
      { id: "stick", count: 1 },
      null,
      null,
      { id: "stick", count: 1 },
      null,
    ],
    result: { id: "wood_pickaxe", count: 1 },
  });

  await page.evaluate(() => {
    const game = window.__game;
    game.craftingTableOverlay.hidden = true;
    game.paused = false;
    game.inventoryOpen = false;
    game.openInventory();
    game.inventory = new game.inventory.constructor();
    game.inventory.slots[27] = { id: "stone", count: 3 };
    game.renderInventory();
  });

  await page.locator('[data-area="inventory"][data-index="27"]').hover();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyQ");
  await page.keyboard.up("Control");

  await expect.poll(() => page.evaluate(() => ({
    slot: window.__game.inventory.slots[27],
    dropped: window.__game.droppedItems
      .filter((item) => item.id === "stone")
      .reduce((sum, item) => sum + item.count, 0),
  }))).toEqual({ slot: null, dropped: 3 });
});

test("uses item sprites and block crack overlay", async ({ page }) => {
  test.setTimeout(70000);
  await page.goto("/");

  const visualState = await page.evaluate(() => {
    const game = window.__game;
    game.inventory.slots[27] = { id: "torch_on", count: 1 };
    game.renderInventory();
    const plankBlock = window.__gameDebug.getBlockIdByItemId("plank");
    game.showBreakOverlay({
      position: { x: 0, y: 64, z: 0 },
      block: plankBlock,
      normal: { x: 0, y: 0, z: 1 },
    }, 0.65);

    const slot = document.querySelector('[data-area="inventory"][data-index="27"]');
    return {
      atlasTileSize: window.__gameDebug.getBlockAtlasTileSize(),
      spriteImage: slot.style.getPropertyValue("--slot-image"),
      slotTitle: slot.title,
      itemBackground: getComputedStyle(slot, "::before").backgroundColor,
      crackVisible: game.breakOverlay.visible,
      crackHasTexture: Boolean(game.breakMaterial.map),
      crackState: window.__gameDebug.getBreakOverlayState(),
      breakTimes: {
        stoneDiamond: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("stone"), "diamond_pickaxe"),
        stoneIron: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("stone"), "iron_pickaxe"),
        stoneStone: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("stone"), "stone_pickaxe"),
        coalWood: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("coal_ore"), "wood_pickaxe"),
        oakLogIronAxe: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("log"), "iron_axe"),
        dirtHand: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("dirt"), null),
        dirtDiamondShovel: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("dirt"), "diamond_shovel"),
        leavesHand: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("leaves"), null),
        leavesShears: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("leaves"), "shears"),
        terracottaHand: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("terracotta"), null),
        terracottaIronPickaxe: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("terracotta"), "iron_pickaxe"),
        pumpkinHand: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("pumpkin"), null),
        pumpkinIronAxe: window.__gameDebug.getBlockBreakTime(window.__gameDebug.getBlockIdByItemId("pumpkin"), "iron_axe"),
      },
      ticksPerSecond: window.__gameDebug.getTicksPerSecond(),
      blockBreakDelay: window.__gameDebug.getBlockBreakDelay(),
      furnaceRecipes: window.__gameDebug.getFurnaceRecipes(),
    };
  });

  expect(visualState.atlasTileSize).toBeGreaterThanOrEqual(16);
  expect(visualState.spriteImage).toContain("torch_on.png");
  expect(visualState.slotTitle).toBe("Torch");
  expect(visualState.itemBackground).toBe("rgba(0, 0, 0, 0)");
  expect(visualState.crackVisible).toBe(true);
  expect(visualState.crackHasTexture).toBe(true);
  expect(visualState.crackState.color).toBe(0xa7773a);
  expect(visualState.crackState.opacity).toBeLessThan(0.8);
  expect(visualState.breakTimes.stoneDiamond).toBeCloseTo(0.3, 2);
  expect(visualState.breakTimes.stoneIron).toBeCloseTo(0.4, 2);
  expect(visualState.breakTimes.stoneStone).toBeCloseTo(0.6, 2);
  expect(visualState.breakTimes.coalWood).toBeCloseTo(2.25, 2);
  expect(visualState.breakTimes.oakLogIronAxe).toBeCloseTo(0.5, 2);
  expect(visualState.breakTimes.dirtHand).toBeCloseTo(0.75, 2);
  expect(visualState.breakTimes.dirtDiamondShovel).toBeCloseTo(0.1, 2);
  expect(visualState.breakTimes.leavesHand).toBeCloseTo(0.3, 2);
  expect(visualState.breakTimes.leavesShears).toBeCloseTo(0.05, 2);
  expect(visualState.breakTimes.terracottaHand).toBeCloseTo(6.25, 2);
  expect(visualState.breakTimes.terracottaIronPickaxe).toBeCloseTo(0.35, 2);
  expect(visualState.breakTimes.pumpkinHand).toBeCloseTo(1.5, 2);
  expect(visualState.breakTimes.pumpkinIronAxe).toBeCloseTo(0.25, 2);
  expect(visualState.ticksPerSecond).toBe(20);
  expect(visualState.blockBreakDelay).toBeCloseTo(0.3, 3);
  expect(visualState.furnaceRecipes).toMatchObject({
    iron_ore: "iron_ingot",
    copper_ore: "copper_ingot",
    gold_ore: "gold_ingot",
    coal_ore: "coal",
    diamond_ore: "diamond",
    emerald_ore: "emerald",
    redstone_ore: "redstone_dust",
    lapis_ore: "dye_powder_blue",
    quartz_ore: "quartz",
  });
});

test("renders held torches and tools as visible first-person items", async ({ page }) => {
  await page.goto("/");

  const heldState = await page.evaluate(async () => {
    const game = window.__game;
    const waitFrames = (count) => new Promise((resolve) => {
      const tick = () => {
        count -= 1;
        if (count <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const isHeldToolId = (id) => /(?:^|_)(?:sword|pickaxe|shovel|axe|hoe)$/.test(id)
      || /^(shears|flint_and_steel|fishing_rod|carrot_on_a_stick|stick)$/.test(id);
    const inspectHeld = async (id) => {
      game.inventory.slots[27] = { id, count: 1 };
      game.selectedHotbar = 0;
      game._lastHeldItemId = null;
      game.renderHotbar();
      if (isHeldToolId(id)) {
        for (let i = 0; i < 30 && !game.heldItemMesh?.userData?.extrudedItem; i += 1) {
          await waitFrames(1);
        }
      }

      const mesh = game.heldItemMesh;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const resetHandArm = () => {
        game.handArm.position.copy(game.handArmDefaultPosition);
        game.handArm.rotation.copy(game.handArmDefaultRotation);
      };
      const resetHeldItem = () => {
        if (mesh.userData?.basePosition) mesh.position.copy(mesh.userData.basePosition);
        if (mesh.userData?.baseRotation) mesh.rotation.copy(mesh.userData.baseRotation);
      };
      const measureProjection = () => {
        game.handCamera.updateMatrixWorld(true);
        game.handArm.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);
        const Vec3 = game.camera.position.constructor;
        const center = mesh.getWorldPosition(new Vec3());
        const right = new Vec3(0.32, 0, 0).applyMatrix4(mesh.matrixWorld);
        const up = new Vec3(0, 0.32, 0).applyMatrix4(mesh.matrixWorld);
        const handleBottom = new Vec3((5.5 / 16 - 0.5) * 0.72, (0.5 - 14.8 / 16) * 0.72, 0)
          .applyMatrix4(mesh.matrixWorld);
        const handleJoin = new Vec3((10.5 / 16 - 0.5) * 0.72, (0.5 - 7.2 / 16) * 0.72, 0)
          .applyMatrix4(mesh.matrixWorld);
        const worldQuaternion = mesh.getWorldQuaternion(new game.camera.quaternion.constructor());
        const normal = new Vec3(0, 0, 1).applyQuaternion(worldQuaternion);
        center.project(game.handCamera);
        right.project(game.handCamera);
        up.project(game.handCamera);
        handleBottom.project(game.handCamera);
        handleJoin.project(game.handCamera);
        const screenRightAngle = Math.atan2(right.y - center.y, right.x - center.x) * 180 / Math.PI;
        const screenRightLength = Math.hypot(right.x - center.x, right.y - center.y);
        const screenUpLength = Math.hypot(up.x - center.x, up.y - center.y);
        const handleAngle = Math.atan2(handleJoin.y - handleBottom.y, handleJoin.x - handleBottom.x) * 180 / Math.PI;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        const size = box.getSize(new Vec3());
        const corners = [];
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              corners.push(new Vec3(x, y, z).applyMatrix4(mesh.matrixWorld).project(game.handCamera));
            }
          }
        }
        const bounds = {
          minX: Math.min(...corners.map((corner) => corner.x)),
          maxX: Math.max(...corners.map((corner) => corner.x)),
          minY: Math.min(...corners.map((corner) => corner.y)),
          maxY: Math.max(...corners.map((corner) => corner.y)),
        };
        return {
          localSize: { x: size.x, y: size.y, z: size.z },
          ndc: { x: center.x, y: center.y, z: center.z },
          screenRightAngle,
          screenRightLength,
          screenUpLength,
          handleAngle,
          normal: { x: normal.x, y: normal.y, z: normal.z },
          bounds,
        };
      };
      resetHandArm();
      resetHeldItem();
      const restProjection = measureProjection();
      game.handSwingActive = true;
      game.handSwingProgress = 0.5;
      game.isMining = false;
      game.updateHandSwing(0);
      const swingProjection = measureProjection();
      resetHandArm();
      resetHeldItem();
      return {
        geometryType: mesh.geometry.type,
        localSize: restProjection.localSize,
        alphaTest: material.alphaTest,
        transparent: material.transparent,
        vertexColors: Boolean(material.vertexColors),
        hasTexture: Boolean(material.map),
        disposesMap: Boolean(material.userData?.disposeMapWithMaterial),
        extrudedItem: Boolean(mesh.userData?.extrudedItem),
        handVisible: game.handArmMaterial.visible,
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        ndc: restProjection.ndc,
        screenRightAngle: restProjection.screenRightAngle,
        screenRightLength: restProjection.screenRightLength,
        screenUpLength: restProjection.screenUpLength,
        handleAngle: restProjection.handleAngle,
        normal: restProjection.normal,
        bounds: restProjection.bounds,
        swingBounds: swingProjection.bounds,
        swingNdc: swingProjection.ndc,
        swingScreenRightAngle: swingProjection.screenRightAngle,
        materialType: material.type,
        color: { r: material.color.r, g: material.color.g, b: material.color.b },
        heldTool: Boolean(mesh.userData?.heldTool),
      };
    };
    const inspectHeldLight = async (id) => {
      const state = await inspectHeld(id);
      const mesh = game.heldItemMesh;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      game.timeOfDay = 6000;
      game.updateSkyCycle(0);
      game.updateHandLighting();
      const day = { r: material.color.r, g: material.color.g, b: material.color.b };
      game.timeOfDay = 18000;
      game.updateSkyCycle(0);
      game.updateHandLighting();
      const night = { r: material.color.r, g: material.color.g, b: material.color.b };
      return { ...state, day, night };
    };

    return {
      torch: await inspectHeld("torch_on"),
      grass: await inspectHeld("grass"),
      pickaxe: await inspectHeld("iron_pickaxe"),
      axe: await inspectHeld("diamond_axe"),
      shovel: await inspectHeld("iron_shovel"),
      sword: await inspectHeld("stone_sword"),
      hoe: await inspectHeld("gold_hoe"),
      litBlock: await inspectHeldLight("grass"),
    };
  });

  expect(heldState.torch.geometryType).toBe("BufferGeometry");
  expect(heldState.torch.materialType).toBe("MeshLambertMaterial");
  expect(heldState.torch.vertexColors).toBe(true);
  expect(heldState.torch.alphaTest).toBeGreaterThan(0);
  expect(heldState.torch.hasTexture).toBe(true);
  expect(heldState.torch.disposesMap).toBe(false);
  expect(heldState.torch.handVisible).toBe(false);
  expect(Math.abs(heldState.torch.ndc.x)).toBeLessThan(0.95);
  expect(Math.abs(heldState.torch.ndc.y)).toBeLessThan(0.95);
  expect(heldState.grass.geometryType).toBe("BufferGeometry");
  expect(heldState.grass.materialType).toBe("MeshLambertMaterial");
  expect(heldState.grass.vertexColors).toBe(true);
  expect(heldState.grass.localSize.x).toBeLessThan(0.4);
  expect(heldState.grass.handVisible).toBe(false);
  expect(heldState.litBlock.day.r).toBeGreaterThan(heldState.litBlock.night.r);
  expect(heldState.litBlock.day.g).toBeGreaterThan(heldState.litBlock.night.g);
  for (const blockState of [heldState.torch, heldState.grass]) {
    expect(blockState.position.x).toBeCloseTo(heldState.pickaxe.position.x, 2);
    expect(blockState.position.y).toBeCloseTo(heldState.pickaxe.position.y, 2);
    expect(blockState.position.z).toBeCloseTo(heldState.pickaxe.position.z, 2);
  }

  expect(heldState.pickaxe.geometryType).toBe("BufferGeometry");
  expect(heldState.pickaxe.localSize.x).toBeGreaterThan(0.55);
  expect(heldState.pickaxe.localSize.z).toBeGreaterThan(0.06);
  expect(heldState.pickaxe.screenRightLength).toBeGreaterThan(0.2);
  expect(heldState.pickaxe.screenUpLength).toBeGreaterThan(0.25);
  expect(heldState.pickaxe.handleAngle).toBeGreaterThan(78);
  expect(heldState.pickaxe.bounds.maxX).toBeGreaterThan(1);
  expect(heldState.pickaxe.bounds.minY).toBeLessThan(-1.2);
  expect(Math.abs(heldState.pickaxe.ndc.x)).toBeLessThan(0.95);
  expect(Math.abs(heldState.pickaxe.ndc.y)).toBeLessThan(0.95);

  for (const toolState of [heldState.pickaxe, heldState.axe, heldState.shovel, heldState.sword, heldState.hoe]) {
    expect(toolState.geometryType).toBe("BufferGeometry");
    expect(toolState.materialType).toBe("MeshLambertMaterial");
    expect(toolState.extrudedItem).toBe(true);
    expect(toolState.heldTool).toBe(true);
    expect(toolState.vertexColors).toBe(true);
    expect(toolState.transparent).toBe(false);
    expect(toolState.hasTexture).toBe(false);
    expect(toolState.disposesMap).toBe(false);
    expect(toolState.handVisible).toBe(false);
    expect(toolState.localSize.x).toBeGreaterThan(0.2);
    expect(toolState.localSize.z).toBeGreaterThan(0.08);
    expect(toolState.rotation.y).toBeLessThan(-0.05);
    expect(toolState.rotation.y).toBeGreaterThan(-0.25);
    expect(toolState.rotation.z).toBeGreaterThan(0.1);
    expect(toolState.normal.z).toBeGreaterThan(0.7);
    expect(toolState.normal.z).toBeLessThan(0.95);
    expect(toolState.swingNdc.x).toBeLessThan(toolState.ndc.x - 0.2);
    expect(toolState.swingNdc.y).toBeLessThan(toolState.ndc.y - 0.07);
    expect(toolState.swingScreenRightAngle - toolState.screenRightAngle).toBeGreaterThan(30);
    expect(toolState.swingBounds.maxY).toBeLessThan(0);
  }
});

test("shows targeted block names near the crosshair", async ({ page }) => {
  await page.goto("/");

  const target = await page.evaluate(() => {
    const game = window.__game;
    const y = 180;
    game.started = true;
    game.paused = false;
    game.inventoryOpen = false;
    for (let z = -5; z <= 0; z += 1) game.world.setBlock(0, y, z, 0);
    game.world.setBlock(0, y, -4, 3);
    game.camera.position.set(0.5, y + 0.5, 0.5);
    game.camera.lookAt(0.5, y + 0.5, -4.5);
    game.camera.updateMatrixWorld(true);
    game.updateTargetLabel();

    return {
      text: document.querySelector(".target-label").textContent,
      visible: document.querySelector(".target-label").classList.contains("is-visible"),
    };
  });

  expect(target).toEqual({
    text: "Bluegranite",
    visible: true,
  });
});

test("places survival blocks on the targeted face", async ({ page }) => {
  await page.goto("/");

  const placement = await page.evaluate(() => {
    const game = window.__game;
    const y = 180;
    game.inventory = new game.inventory.constructor();
    game.inventory.slots[27] = { id: "plank", count: 1 };
    game.player.mode = "survival";
    game.selectedHotbar = 0;
    for (let z = -5; z <= 0; z += 1) game.world.setBlock(0, y, z, 0);
    game.world.setBlock(0, y, -4, 3);
    game.camera.position.set(0.5, y + 0.5, 0.5);
    game.camera.lookAt(0.5, y + 0.5, -4.5);
    game.camera.updateMatrixWorld(true);

    game.placeTargetBlock();

    return {
      placedBlock: game.world.getBlock(0, y, -3),
      targetBlock: game.world.getBlock(0, y, -4),
      inventorySlot: game.inventory.slots[27],
    };
  });

  expect(placement).toEqual({
    placedBlock: 7,
    targetBlock: 3,
    inventorySlot: null,
  });
});

test("places, targets, supports, and lights torches like minecraft", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    const torchBlock = window.__gameDebug.getBlockIdByItemId("torch_on");
    const anvilBlock = window.__gameDebug.getBlockIdByItemId("anvil");
    const y = 180;

    game.started = true;
    game.paused = false;
    game.inventoryOpen = false;
    game.settingsOpen = false;
    game.chatOpen = false;
    game.player.mode = "creative";
    game.inventory = new game.inventory.constructor();
    game.inventory.slots[27] = { id: "torch_on", count: 16 };
    game.selectedHotbar = 0;

    for (let x = -2; x <= 6; x += 1) {
      for (let z = -7; z <= 1; z += 1) {
        for (let yy = y - 1; yy <= y + 2; yy += 1) {
          game.world.setBlock(x, yy, z, 0);
        }
      }
    }

    game.world.setBlock(0, y, -4, 3);
    game.camera.position.set(0.5, y + 0.55, 0.5);
    game.camera.lookAt(0.5, y + 0.55, -4.5);
    game.camera.updateMatrixWorld(true);
    game.placeTargetBlock();

    const wallTorchBlock = game.world.getBlock(0, y, -3);
    const wallLight = game.world.getBlockLightLevel(0, y, -3);
    const torchLightColor = window.__gameDebug.getBlockLightColorFactors(13);
    game.world.updateDynamicBlockLights(game.camera.position, 1);
    const activeLights = window.__gameDebug.getActiveDynamicBlockLights();
    game.camera.position.set(0.5, y + 0.55, 22.5);
    game.camera.updateMatrixWorld(true);
    game.world.updateDynamicBlockLights(game.camera.position, 1);
    const activeLightsFar = window.__gameDebug.getActiveDynamicBlockLights();
    game.camera.position.set(0.5, y + 0.55, 0.5);
    game.camera.lookAt(0.5, y + 0.55, -4.5);
    game.camera.updateMatrixWorld(true);
    const wallHit = game.raycastBlock();
    const wallHitIsTorch = wallHit?.position.x === 0 && wallHit.position.y === y && wallHit.position.z === -3;
    if (wallHit) game.finishBreakingBlock(wallHit);
    const wallTorchAfterBreak = game.world.getBlock(0, y, -3);
    const wallSupportAfterBreak = game.world.getBlock(0, y, -4);

    const floorX = 3;
    const floorZ = -3;
    game.world.setBlock(floorX, y - 1, floorZ, 3);
    game.camera.position.set(floorX + 0.5, y + 2.2, floorZ + 0.5);
    game.camera.lookAt(floorX + 0.5, y - 0.5, floorZ + 0.5);
    game.camera.updateMatrixWorld(true);
    game.placeTargetBlock();
    const floorTorchPlaced = game.world.getBlock(floorX, y, floorZ);
    game.world.setBlock(floorX, y - 1, floorZ, 0);
    game.updateUnsupportedPlantsAround(floorX, y - 1, floorZ, false);
    const floorTorchAfterSupportBreak = game.world.getBlock(floorX, y, floorZ);

    const underwaterX = 5;
    game.world.setBlock(underwaterX, y - 1, floorZ, 3);
    game.world.setBlock(underwaterX, y, floorZ, 20, { waterLevel: 0, isSource: true });
    const underwaterTorchAllowed = game.canPlaceBlockAt(torchBlock, underwaterX, y, floorZ);
    const underwaterDropsBefore = game.droppedItems.length;
    game.camera.position.set(underwaterX + 0.5, y + 2.2, floorZ + 0.5);
    game.camera.lookAt(underwaterX + 0.5, y - 0.5, floorZ + 0.5);
    game.camera.updateMatrixWorld(true);
    game.placeTargetBlock();
    const underwaterBlockAfterPlace = game.world.getBlock(underwaterX, y, floorZ);
    const underwaterDropDelta = game.droppedItems.length - underwaterDropsBefore;

    const flowX = -2;
    const flowDropsBefore = game.droppedItems.length;
    game.world.setBlock(flowX, y - 1, floorZ, 3);
    game.world.setBlock(flowX, y, floorZ, torchBlock);
    game.world.setBlock(flowX, y, floorZ, 20, { waterLevel: 1, isSource: false });
    const flowBlockAfterReplace = game.world.getBlock(flowX, y, floorZ);
    const flowDropDelta = game.droppedItems.length - flowDropsBefore;

    const spreadSourceX = -5;
    const spreadTorchX = -4;
    const spreadZ = floorZ;
    const spreadDropsBefore = game.droppedItems.length;
    game.world.setBlock(spreadSourceX, y - 1, spreadZ, 3);
    game.world.setBlock(spreadTorchX, y - 1, spreadZ, 3);
    game.world.setBlock(spreadTorchX, y, spreadZ, torchBlock);
    game.world.setBlock(spreadSourceX, y, spreadZ, 20, { waterLevel: 0, isSource: true });
    for (let i = 0; i < 16; i += 1) game.world.stepWater(80);
    const spreadFlowBlockAfter = game.world.getBlock(spreadTorchX, y, spreadZ);
    const spreadFlowDropDelta = game.droppedItems.length - spreadDropsBefore;

    const anvilX = 6;
    const anvilZ = floorZ;
    for (let yy = y - 1; yy <= y + 2; yy += 1) game.world.setBlock(anvilX, yy, anvilZ, 0);
    game.world.setBlock(anvilX, y - 1, anvilZ, 3);
    game.world.setBlock(anvilX, y, anvilZ, torchBlock);
    game.world.setBlock(anvilX, y + 1, anvilZ, anvilBlock);
    game.scheduleFallingBlockCheck(anvilX, y + 1, anvilZ);
    for (let i = 0; i < 80; i += 1) game.updateFallingBlocks(0.05);

    const floorSelection = window.__gameDebug.getSelectionBoxesByDefinitionId("torch_on")[0];
    const northWallSelections = window.__gameDebug.getSelectionBoxesByDefinitionId("torch_on_wall_north");
    const northWallSelection = northWallSelections[0];
    const outlineX = 4;
    const outlineZ = -5;
    game.world.setBlock(outlineX, y - 1, outlineZ, 3);
    game.world.setBlock(outlineX, y, outlineZ, torchBlock);
    game.camera.position.set(outlineX + 0.5, y + 2.1, outlineZ + 0.42);
    game.camera.lookAt(outlineX + 0.5, y + 0.35, outlineZ + 0.5);
    game.camera.updateMatrixWorld(true);
    game.updateTargetOutline();
    const torchOutlineBounds = window.__gameDebug.getTargetOutlineLocalBounds();
    game.showBreakOverlay({
      position: { x: outlineX, y, z: outlineZ },
      block: torchBlock,
      normal: { x: 0, y: 1, z: 0 },
    }, 0.45);
    const torchBreakOverlayState = window.__gameDebug.getBreakOverlayState();

    return {
      torchBlock,
      wallTorchBlock,
      wallLight,
      torchLightColor,
      activeLights,
      activeLightsFar,
      wallHitIsTorch,
      wallTorchAfterBreak,
      wallSupportAfterBreak,
      floorTorchPlaced,
      floorTorchAfterSupportBreak,
      unsupportedFloorPlacement: game.canPlaceBlockAt(torchBlock, floorX + 2, y, floorZ + 1),
      underwaterTorchAllowed,
      underwaterBlockAfterPlace,
      underwaterDropDelta,
      flowBlockAfterReplace,
      flowDropDelta,
      spreadFlowBlockAfter,
      spreadFlowDropDelta,
      torchAfterAnvil: game.world.getBlock(anvilX, y, anvilZ),
      anvilBlock,
      floorSelection,
      northWallSelection,
      northWallSelectionCount: northWallSelections.length,
      torchOutlineBounds,
      torchBreakOverlayState,
      waterTint: window.__gameDebug.getDefaultWaterTint(),
    };
  });

  expect(state.wallTorchBlock).not.toBe(0);
  expect(state.wallTorchBlock).not.toBe(state.torchBlock);
  expect(state.wallLight).toBe(14);
  expect(state.torchLightColor.r).toBeGreaterThan(1.1);
  expect(state.torchLightColor.g).toBeLessThan(state.torchLightColor.r);
  expect(state.torchLightColor.g).toBeGreaterThan(state.torchLightColor.r * 0.82);
  expect(state.torchLightColor.b).toBeLessThan(state.torchLightColor.g);
  expect(state.torchLightColor.b).toBeGreaterThan(state.torchLightColor.r * 0.62);
  expect(state.activeLights.length).toBeGreaterThan(0);
  expect(state.activeLights[0].intensity).toBeGreaterThan(1.5);
  expect(state.activeLights[0].distance).toBeGreaterThan(28);
  expect(state.activeLights[0].color).toBe(0xffd49a);
  expect(state.activeLightsFar.length).toBeGreaterThan(0);
  expect(state.activeLightsFar[0].distance).toBeGreaterThan(28);
  expect(state.waterTint).toBe(0x3f76e4);
  expect(state.wallHitIsTorch).toBe(true);
  expect(state.wallTorchAfterBreak).toBe(0);
  expect(state.wallSupportAfterBreak).toBe(3);
  expect(state.floorTorchPlaced).toBe(state.torchBlock);
  expect(state.floorTorchAfterSupportBreak).toBe(0);
  expect(state.unsupportedFloorPlacement).toBe(false);
  expect(state.underwaterTorchAllowed).toBe(true);
  expect(state.underwaterBlockAfterPlace).toBe(20);
  expect(state.underwaterDropDelta).toBe(1);
  expect(state.flowBlockAfterReplace).toBe(20);
  expect(state.flowDropDelta).toBe(1);
  expect(state.spreadFlowBlockAfter).toBe(20);
  expect(state.spreadFlowDropDelta).toBe(1);
  expect(state.torchAfterAnvil).toBe(state.anvilBlock);
  expect(state.floorSelection.maxY).toBeLessThanOrEqual(0.625);
  expect(state.northWallSelectionCount).toBe(1);
  expect(state.northWallSelection.maxX - state.northWallSelection.minX).toBeCloseTo(0.3, 2);
  expect(state.northWallSelection.maxX - state.northWallSelection.minX).toBeLessThan(0.4);
  expect(state.northWallSelection.maxY - state.northWallSelection.minY).toBeLessThanOrEqual(0.61);
  expect(state.northWallSelection.maxY).toBeLessThanOrEqual(0.8);
  expect(state.torchOutlineBounds.maxX - state.torchOutlineBounds.minX).toBeLessThan(0.16);
  expect(state.torchOutlineBounds.maxY - state.torchOutlineBounds.minY).toBeLessThan(0.66);
  expect(state.torchBreakOverlayState.scale.x).toBeLessThan(0.16);
  expect(state.torchBreakOverlayState.scale.y).toBeLessThan(0.66);
});

test("shows a target outline in range and dims the hand at night", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    const y = 180;

    game.started = true;
    game.paused = false;
    game.inventoryOpen = false;
    game.settingsOpen = false;
    game.chatOpen = false;
    game.player.mode = "survival";

    for (let x = -1; x <= 1; x += 1) {
      for (let z = -5; z <= 0; z += 1) {
        for (let yy = y - 1; yy <= y + 1; yy += 1) game.world.setBlock(x, yy, z, 0);
      }
    }

    game.world.setBlock(0, y, -3, 3);
    game.camera.position.set(0.5, y + 0.5, 0.5);
    game.camera.lookAt(0.5, y + 0.5, -3.5);
    game.camera.updateMatrixWorld(true);
    game.updateTargetOutline();
    const outlineOnTarget = window.__gameDebug.getTargetOutlineState();

    game.camera.lookAt(0.5, y + 4, 0.5);
    game.camera.updateMatrixWorld(true);
    game.updateTargetOutline();
    const outlineOffTarget = window.__gameDebug.getTargetOutlineState();

    game.camera.position.set(0.5, y + 2, 0.5);
    game.timeOfDay = 6000;
    game.updateSkyCycle(0);
    game.updateHandLighting();
    const dayHand = window.__gameDebug.getHandMaterialColor();

    game.timeOfDay = 18000;
    game.updateSkyCycle(0);
    game.updateHandLighting();
    const nightHand = window.__gameDebug.getHandMaterialColor();

    return { outlineOnTarget, outlineOffTarget, dayHand, nightHand };
  });

  expect(state.outlineOnTarget.visible).toBe(true);
  expect(state.outlineOnTarget.z).toBe(-2.5);
  expect(state.outlineOffTarget.visible).toBe(false);
  expect(state.dayHand.r).toBeGreaterThan(0.95);
  expect(state.nightHand.r).toBeLessThan(0.35);
});

test("locates biomes, fades chat, and applies plant support rules", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    game.allowCheats = true;
    game.started = true;
    game.paused = false;
    game.inventoryOpen = false;
    game.settingsOpen = false;
    game.chatOpen = false;

    const currentBiome = game.world.biomeAt(
      Math.floor(game.player.position.x),
      Math.floor(game.player.position.z),
    );
    game.executeChatCommand(`locatebiome ${currentBiome}`);
    const locateMessage = game.chatMessages.at(-1)?.text ?? "";

    game.addChatMessage("temporary", "system");
    game.chatMessages[game.chatMessages.length - 1].createdAt = performance.now() - 8000;
    game.renderChatMessages();
    game.updateChatMessageVisibility();
    const fadedOpacity = Number(game.chatMessagesElement.lastElementChild.style.opacity);
    game.chatOpen = true;
    game.updateChatMessageVisibility();
    const openOpacity = Number(game.chatMessagesElement.lastElementChild.style.opacity);
    game.chatOpen = false;

    const y = 180;
    for (let z = -5; z <= 0; z += 1) game.world.setBlock(0, y, z, 0);
    game.world.setBlock(0, y, -4, 52);
    game.player.mode = "survival";
    game.camera.position.set(0.5, y + 0.5, 0.5);
    game.camera.lookAt(0.5, y + 0.5, -3.5);
    game.camera.updateMatrixWorld(true);
    const plantHit = game.raycastBlock();
    const dropsBefore = game.droppedItems.length;
    if (plantHit) game.finishBreakingBlock(plantHit);

    const cactusX = 12;
    const cactusY = 181;
    const cactusZ = 12;
    game.world.setBlock(cactusX, cactusY, cactusZ, 0);
    game.world.setBlock(cactusX, cactusY - 1, cactusZ, 4);
    game.world.setBlock(cactusX + 1, cactusY, cactusZ, 0);
    game.world.setBlock(cactusX - 1, cactusY, cactusZ, 0);
    game.world.setBlock(cactusX, cactusY, cactusZ + 1, 0);
    game.world.setBlock(cactusX, cactusY, cactusZ - 1, 0);
    const cactusFree = game.canPlaceBlockAt(19, cactusX, cactusY, cactusZ);
    game.world.setBlock(cactusX + 1, cactusY, cactusZ, 3);
    const cactusBlocked = game.canPlaceBlockAt(19, cactusX, cactusY, cactusZ);

    const vineX = 20;
    const vineZ = 20;
    game.world.setBlock(vineX, y, vineZ, 0);
    game.world.setBlock(vineX - 1, y, vineZ, 3);
    const vineSupported = game.canPlaceBlockAt(60, vineX, y, vineZ);
    game.world.setBlock(vineX, y, vineZ, 60);
    game.world.setBlock(vineX - 1, y, vineZ, 0);
    game.updateUnsupportedPlantsAround(vineX - 1, y, vineZ, false);

    const cactusPlaceX = 28;
    const cactusPlaceZ = -4;
    for (let z = -6; z <= 0; z += 1) {
      game.world.setBlock(cactusPlaceX, y, z, 0);
      game.world.setBlock(cactusPlaceX, y - 1, z, 4);
    }
    game.world.setBlock(cactusPlaceX, y, cactusPlaceZ, 55);
    game.selectedHotbar = 7;
    game.player.mode = "creative";
    game.camera.position.set(cactusPlaceX + 0.5, y + 0.5, 0.5);
    game.camera.lookAt(cactusPlaceX + 0.5, y + 0.5, cactusPlaceZ + 0.5);
    game.camera.updateMatrixWorld(true);
    game.placeTargetBlock();

    const cactusTopX = 36;
    const cactusTopY = 180;
    const cactusTopZ = -4;
    for (let z = -6; z <= 0; z += 1) {
      game.world.setBlock(cactusTopX, cactusTopY, z, 0);
      game.world.setBlock(cactusTopX, cactusTopY + 1, z, 0);
    }
    game.world.setBlock(cactusTopX, cactusTopY, cactusTopZ, 4);
    game.world.setBlock(cactusTopX + 1, cactusTopY + 1, cactusTopZ, 0);
    game.world.setBlock(cactusTopX - 1, cactusTopY + 1, cactusTopZ, 0);
    game.world.setBlock(cactusTopX, cactusTopY + 1, cactusTopZ + 1, 0);
    game.world.setBlock(cactusTopX, cactusTopY + 1, cactusTopZ - 1, 0);
    game.selectedHotbar = 7;
    game.player.mode = "creative";
    game.camera.position.set(cactusTopX + 0.5, cactusTopY + 0.5, 0.5);
    game.camera.lookAt(cactusTopX + 0.5, cactusTopY + 0.5, cactusTopZ + 0.5);
    game.camera.updateMatrixWorld(true);
    game.placeTargetBlock();

    return {
      locateMessage,
      fadedOpacity,
      openOpacity,
      plantHitBlock: plantHit?.block ?? null,
      plantRemoved: game.world.getBlock(0, y, -4),
      plantDropAdded: game.droppedItems.length > dropsBefore,
      cactusFree,
      cactusBlocked,
      vineSupported,
      vineRemoved: game.world.getBlock(vineX, y, vineZ),
      cactusPlacedOverPlant: game.world.getBlock(cactusPlaceX, y, cactusPlaceZ),
      cactusPlacedOnSandTop: game.world.getBlock(cactusTopX, cactusTopY + 1, cactusTopZ),
      cactusBaseStayedSand: game.world.getBlock(cactusTopX, cactusTopY, cactusTopZ),
    };
  });

  expect(state.locateMessage).toMatch(/^Nearest /);
  expect(state.fadedOpacity).toBe(0);
  expect(state.openOpacity).toBe(1);
  expect(state.plantHitBlock).toBe(52);
  expect(state.plantRemoved).toBe(0);
  expect(state.plantDropAdded).toBe(true);
  expect(state.cactusFree).toBe(true);
  expect(state.cactusBlocked).toBe(false);
  expect(state.vineSupported).toBe(true);
  expect(state.vineRemoved).toBe(0);
  expect(state.cactusPlacedOverPlant).toBe(19);
  expect(state.cactusPlacedOnSandTop).toBe(19);
  expect(state.cactusBaseStayedSand).toBe(4);
});

test("tracks survival health, hunger, fall damage, cactus damage, and drowning air", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    game.started = true;
    game.player.mode = "survival";
    game.player.position.set(44.5, 180, 44.5);
    game.player.velocity.set(0, 0, 0);
    game.resetSurvivalStats();

    game.applyDamage(5, "test", { ignoreInvulnerability: true });
    const damagedHealth = game.health;
    const healthFullCellsAfterDamage = document.querySelectorAll(".health-cell.is-full").length;
    game.heal(5);

    game.player.landedFallDistance = 7;
    game.damageInvulnerability = 0;
    game.updateSurvivalStats(0.05);
    const fallHealth = game.health;

    game.health = 20;
    game.damageInvulnerability = 0;
    game.cactusDamageTimer = 0;
    game.world.setBlock(44, 179, 44, 4);
    game.world.setBlock(44, 180, 44, 19);
    game.updateHazardDamage(0.5);
    const cactusHealth = game.health;

    game.health = 20;
    game.damageInvulnerability = 0;
    game.player.eyeInWater = true;
    game.airTicks = 0;
    game.drownDamageTimer = 0;
    game.updateAirSupply(1);
    game.renderVitals();
    const drownHealth = game.health;
    const airVisible = !document.querySelector(".air-bubbles").hidden;
    const emptyAirCells = document.querySelectorAll(".air-cell.is-empty").length;

    game.hunger = 20;
    game.saturation = 0;
    game.addExhaustion(4);
    const hungerAfterExhaustion = game.hunger;
    game.health = 10;
    game.hunger = 0;
    game.starvationTimer = 0;
    game.damageInvulnerability = 0;
    game.updateHungerHealth(3);
    const starvationHealth = game.health;

    game.health = 18;
    game.hunger = 20;
    game.saturation = 5;
    game.healthRegenTimer = 0;
    game.updateHungerHealth(4);
    const regenHealth = game.health;

    return {
      visible: !document.querySelector(".survival-bars").hidden,
      damagedHealth,
      healthFullCellsAfterDamage,
      fallHealth,
      cactusHealth,
      drownHealth,
      airVisible,
      emptyAirCells,
      hungerAfterExhaustion,
      starvationHealth,
      regenHealth,
    };
  });

  expect(state.visible).toBe(true);
  expect(state.damagedHealth).toBe(15);
  expect(state.healthFullCellsAfterDamage).toBe(7);
  expect(state.fallHealth).toBe(16);
  expect(state.cactusHealth).toBe(19);
  expect(state.drownHealth).toBe(18);
  expect(state.airVisible).toBe(true);
  expect(state.emptyAirCells).toBe(10);
  expect(state.hungerAfterExhaustion).toBe(19);
  expect(state.starvationHealth).toBe(9);
  expect(state.regenHealth).toBe(19);
});

test("generates transparent water and lets it flow downward", async ({ page }) => {
  await page.goto("/");

  const water = await page.evaluate(() => {
    const game = window.__game;
    let generated = null;

    for (let z = -96; z <= 96 && !generated; z += 4) {
      for (let x = -96; x <= 96; x += 4) {
        const y = game.world.terrainHeight(x, z);
        if (y >= 63) continue;
        generated = {
          x,
          z,
          topWater: game.world.getBlock(x, 63, z),
          level: game.world.getWaterLevel(x, 63, z),
          surfaceHeight: game.world.waterSurfaceHeightAt(x, 63, z),
        };
        break;
      }
    }

    const y = 90;
    game.world.setBlock(2, y, 2, 20, { waterLevel: 0 });
    game.world.setBlock(2, y - 1, 2, 0);
    for (let tick = 0; tick < 5; tick += 1) game.world.stepWater(8);

    const clearOptions = { skipWaterUpdate: true, skipLavaUpdate: true, skipLiquidInteractions: true };
    for (let x = 5; x <= 10; x += 1) {
      for (let z = 4; z <= 6; z += 1) {
        for (let yy = y - 9; yy <= y + 1; yy += 1) {
          game.world.setBlock(x, yy, z, 0, clearOptions);
        }
      }
    }
    game.world.setBlock(6, y - 1, 5, 3, clearOptions);
    game.world.setBlock(6, y, 5, 20, { ...clearOptions, waterLevel: 0, isSource: true });
    game.world.setBlock(9, y - 9, 5, 3, clearOptions);
    for (let yy = y - 8; yy <= y; yy += 1) {
      game.world.setBlock(9, yy, 5, 20, { ...clearOptions, waterLevel: 0, isSource: true });
    }

    game.world.ensureChunksAround(game.player.position, 1, 9);
    const controlledChunk = game.world.chunks.get(game.world.key(0, 0));
    controlledChunk?.rebuildMesh();
    const waterMesh = controlledChunk?.waterMesh ?? [...game.world.chunks.values()].find((chunk) => chunk.waterMesh)?.waterMesh;
    const waterMap = waterMesh?.material.map ?? waterMesh?.material.uniforms?.map?.value;
    const sampleWaterTopColor = (blockX, blockZ) => {
      const positions = waterMesh?.geometry.getAttribute("position");
      const colors = waterMesh?.geometry.getAttribute("color");
      if (!positions || !colors) return { count: 0 };
      const topY = y + 0.875;
      const sample = { count: 0, r: 0, g: 0, b: 0, alpha: 0 };
      for (let i = 0; i < positions.count; i += 1) {
        const px = positions.getX(i);
        const py = positions.getY(i);
        const pz = positions.getZ(i);
        if (px < blockX - 0.001 || px > blockX + 1.001) continue;
        if (pz < blockZ - 0.001 || pz > blockZ + 1.001) continue;
        if (Math.abs(py - topY) > 0.002) continue;
        sample.r += colors.getX(i);
        sample.g += colors.getY(i);
        sample.b += colors.getZ(i);
        sample.alpha += colors.itemSize >= 4 ? colors.getW(i) : 1;
        sample.count += 1;
      }
      if (sample.count === 0) return sample;
      sample.r /= sample.count;
      sample.g /= sample.count;
      sample.b /= sample.count;
      sample.alpha /= sample.count;
      sample.luminance = sample.r * 0.2126 + sample.g * 0.7152 + sample.b * 0.0722;
      return sample;
    };

    return {
      generated,
      flowedDown: game.world.getBlock(2, y - 1, 2),
      flowedLevel: game.world.getWaterLevel(2, y - 1, 2),
      waterMesh: Boolean(waterMesh),
      depthWrite: waterMesh?.material.depthWrite,
      opacity: waterMesh?.material.opacity,
      materialSide: waterMesh?.material.side,
      waterTextureWidth: waterMap?.image?.width,
      waterColorItemSize: waterMesh?.geometry.getAttribute("color")?.itemSize,
      meshDepthTint: {
        shallow: sampleWaterTopColor(6, 5),
        deep: sampleWaterTopColor(9, 5),
      },
      shallowTint: window.__gameDebug.getWaterDepthTintSample(1),
      deepTint: window.__gameDebug.getWaterDepthTintSample(18),
      shallowSubmergedTint: window.__gameDebug.getSubmergedDepthTintSample(1),
      deepSubmergedTint: window.__gameDebug.getSubmergedDepthTintSample(18),
      surfaceLight: window.__gameDebug.getUnderwaterLightColorSample(0),
      shallowUnderwaterLight: window.__gameDebug.getUnderwaterLightColorSample(1),
      deepUnderwaterLight: window.__gameDebug.getUnderwaterLightColorSample(18),
      shallowLitSubmergedTint: window.__gameDebug.getUnderwaterLitSubmergedTintSample(1),
      deepLitSubmergedTint: window.__gameDebug.getUnderwaterLitSubmergedTintSample(18),
      hasWaveAttribute: Boolean(waterMesh?.geometry.getAttribute("waterWave")),
    };
  });

  expect(water.generated).toMatchObject({ topWater: 20, level: 0, surfaceHeight: 0.875 });
  expect(water.flowedDown).toBe(20);
  expect(water.flowedLevel).toBe(0);
  expect(water.waterMesh).toBe(true);
  expect(water.depthWrite).toBe(false);
  expect(water.opacity).toBe(1);
  expect(water.materialSide).toBe(2);
  expect(water.waterTextureWidth).toBe(16);
  expect(water.waterColorItemSize).toBe(4);
  expect(water.meshDepthTint.shallow.count).toBeGreaterThan(0);
  expect(water.meshDepthTint.deep.count).toBeGreaterThan(0);
  expect(water.meshDepthTint.deep.alpha).toBeGreaterThan(water.meshDepthTint.shallow.alpha);
  expect(water.meshDepthTint.deep.luminance).toBeLessThan(water.meshDepthTint.shallow.luminance * 0.8);
  expect(water.deepTint.alpha).toBeGreaterThan(water.shallowTint.alpha);
  expect(water.shallowTint.alpha).toBeLessThan(0.4);
  expect(water.deepTint.alpha).toBeLessThan(0.68);
  expect(water.deepTint.luminance).toBeGreaterThan(0.16);
  expect(water.deepTint.luminance).toBeLessThan(water.shallowTint.luminance * 0.8);
  expect(water.shallowSubmergedTint.luminance).toBeLessThan(0.7);
  expect(water.deepSubmergedTint.luminance).toBeLessThan(water.shallowSubmergedTint.luminance);
  expect(water.deepSubmergedTint.b).toBeGreaterThan(water.deepSubmergedTint.r);
  expect(water.shallowUnderwaterLight.r).toBeLessThan(water.surfaceLight.r * 0.75);
  expect(water.deepUnderwaterLight.r).toBeLessThan(water.shallowUnderwaterLight.r);
  expect(water.shallowLitSubmergedTint.luminance).toBeLessThan(0.52);
  expect(water.deepLitSubmergedTint.luminance).toBeLessThan(water.shallowLitSubmergedTint.luminance);
  expect(water.hasWaveAttribute).toBe(true);
});

test("does not cap falling water over a one block drop", async ({ page }) => {
  await page.goto("/");

  const water = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    for (let x = -2; x <= 3; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        for (let y = 87; y <= 92; y += 1) {
          world.setBlock(x, y, z, 0, { skipWaterUpdate: true });
        }
      }
    }

    world.setBlock(0, 89, 0, 3, { skipWaterUpdate: true });
    world.setBlock(1, 88, 0, 3, { skipWaterUpdate: true });
    world.setBlock(0, 90, 0, 20, { waterLevel: 0, isSource: true });
    world.setBlock(1, 90, 0, 20, { waterLevel: 1, isSource: false });
    world.ensureChunksAround({ x: 0, z: 0 }, 1, 9, { timeBudgetMs: 50 });

    const chunk = world.chunks.get(world.key(0, 0));
    chunk.rebuildMesh();
    const positions = chunk.waterMesh.geometry.getAttribute("position");
    const normals = chunk.waterMesh.geometry.getAttribute("normal");
    let cappedVertices = 0;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const ny = normals.getY(index);
      if (x >= 1 && x <= 2 && z >= 0 && z <= 1 && Math.abs(y - 91) < 0.0001 && ny > 0.9) {
        cappedVertices += 1;
      }
    }

    return {
      fallingBlock: world.getBlock(1, 90, 0),
      lowerBlock: world.getBlock(1, 89, 0),
      cappedVertices,
    };
  });

  expect(water.fallingBlock).toBe(20);
  expect(water.lowerBlock).toBe(0);
  expect(water.cappedVertices).toBe(0);
});

test("fills the falling water cap under a stair-step lip", async ({ page }) => {
  await page.goto("/");

  const water = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    for (let x = -2; x <= 3; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        for (let y = 87; y <= 93; y += 1) {
          world.setBlock(x, y, z, 0, { skipWaterUpdate: true, skipLavaUpdate: true });
        }
      }
    }

    world.setBlock(1, 91, 0, 20, { waterLevel: 1, isSource: false, skipWaterUpdate: true });
    world.setBlock(1, 90, 0, 20, { waterLevel: 0, isSource: false, waterFalling: true, skipWaterUpdate: true });
    world.ensureChunksAround({ x: 0, z: 0 }, 1, 9, { timeBudgetMs: 50 });

    const chunk = world.chunks.get(world.key(0, 0));
    chunk.rebuildMesh();
    const positions = chunk.waterMesh.geometry.getAttribute("position");
    const normals = chunk.waterMesh.geometry.getAttribute("normal");
    let capVertices = 0;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const ny = normals.getY(index);
      if (x >= 1 && x <= 2 && z >= 0 && z <= 1 && Math.abs(y - 91) < 0.0001 && ny > 0.9) {
        capVertices += 1;
      }
    }

    return {
      lip: world.getBlock(1, 91, 0),
      falling: world.getBlock(1, 90, 0),
      fallingFlag: world.isWaterFallingAt(1, 90, 0),
      capVertices,
    };
  });

  expect(water).toMatchObject({
    lip: 20,
    falling: 20,
    fallingFlag: true,
  });
  expect(water.capVertices).toBeGreaterThanOrEqual(4);
});

test("swims upward and shows underwater camera effect", async ({ page }) => {
  await page.goto("/");

  const swim = await page.evaluate(() => {
    const game = window.__game;
    game.started = true;
    game.player.position.set(0.5, 90.1, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.keys.clear();
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 92, 0, 20, { waterLevel: 0 });
    const beforeY = game.player.position.y;
    game.player.keys.add("Space");
    game.player.update(0.2);
    game.updateUnderwaterView();

    return {
      rose: game.player.position.y > beforeY,
      inWater: game.player.inWater,
      eyeInWater: game.player.eyeInWater,
      overlayVisible: document.querySelector(".underwater-overlay").classList.contains("is-visible"),
      overlayOpacity: Number.parseFloat(document.querySelector(".underwater-overlay").style.getPropertyValue("--underwater-opacity")),
      fogColor: game.scene.fog.color.getHex(),
      fogNear: game.scene.fog.near,
      fogFar: game.scene.fog.far,
    };
  });

  expect(swim.rose).toBe(true);
  expect(swim.inWater).toBe(true);
  expect(swim.eyeInWater).toBe(true);
  expect(swim.overlayVisible).toBe(true);
  expect(swim.overlayOpacity).toBeLessThan(0.5);
  expect(swim.fogColor).toBe(0x3f76e4);
  expect(swim.fogNear).toBeGreaterThanOrEqual(4);
  expect(swim.fogFar).toBeGreaterThanOrEqual(40);
  expect(swim.fogFar).toBeLessThan(60);
});

test("keeps passive mobs from falling through terrain or unloaded chunks", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    const y = 112;
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        for (let yy = y - 2; yy <= y + 3; yy += 1) {
          game.world.setBlock(x, yy, z, yy === y - 1 ? 3 : 0, { skipWaterUpdate: true, skipLavaUpdate: true });
        }
      }
    }

    const spawnPosition = game.player.position.clone();
    spawnPosition.set(0.5, y, 0.5);
    const mob = game.spawnMob("pig", spawnPosition);
    mob.aiState = "idle";
    mob.aiTimer = 999;
    mob.moveDirection.set(0, 0, 0);
    for (let tick = 0; tick < 160; tick += 1) {
      mob.update(1 / 60, { player: game.player });
    }
    const unloadedSolid = game.world.isSolidBlock(9999, y, 9999);
    const floorSolid = game.world.isSolidBlock(0, y - 1, 0);
    const airAboveFloorSolid = game.world.isSolidBlock(0, y, 0);
    mob.removed = true;

    return {
      mobY: mob.position.y,
      onGround: mob.onGround,
      unloadedSolid,
      floorSolid,
      airAboveFloorSolid,
    };
  });

  expect(state.mobY).toBeGreaterThan(111.9);
  expect(state.mobY).toBeLessThan(112.2);
  expect(state.onGround).toBe(true);
  expect(state.unloadedSolid).toBe(true);
  expect(state.floorSolid).toBe(true);
  expect(state.airAboveFloorSolid).toBe(false);
});

test("uses Minecraft animal geometry and makes hurt animals panic away immediately", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(() => {
    const game = window.__game;
    const floorY = 112;
    for (let x = -12; x <= 12; x += 1) {
      for (let z = -12; z <= 12; z += 1) {
        for (let y = floorY - 1; y <= floorY + 4; y += 1) {
          game.world.setBlock(x, y, z, y === floorY - 1 ? 3 : 0, { skipWaterUpdate: true, skipLavaUpdate: true });
        }
      }
    }

    const chicken = game.spawnMob("chicken", game.player.position.clone().set(-5.5, floorY, 0.5));
    const cow = game.spawnMob("cow", game.player.position.clone().set(5.5, floorY, 0.5));
    const pig = game.spawnMob("pig", game.player.position.clone().set(0.5, floorY, 0.5));
    const start = pig.position.clone();
    const attacker = game.player.position.clone().set(-4.5, floorY, 0.5);
    pig.takeHit(1, attacker, 1);
    const initialAwayDot = pig.moveDirection.x;
    const panicImmediately = pig.panicTimer;
    for (let tick = 0; tick < 120; tick += 1) pig.update(1 / 60, { player: game.player });

    const geometry = (part) => ({
      width: part.geometry.parameters.width,
      height: part.geometry.parameters.height,
      depth: part.geometry.parameters.depth,
    });
    const result = {
      chickenLeg: geometry(chicken.parts.leftLeg),
      cowHorn: geometry(cow.parts.leftHorn),
      cowUdder: geometry(cow.parts.udder),
      cowHasPairOfHorns: Boolean(cow.parts.leftHorn && cow.parts.rightHorn),
      initialAwayDot,
      panicImmediately,
      remainingPanic: pig.panicTimer,
      distance: pig.position.distanceTo(start),
      movedAway: pig.position.x > start.x,
    };
    chicken.removed = true;
    cow.removed = true;
    pig.removed = true;
    return result;
  });

  expect(state.chickenLeg).toMatchObject({ width: 3 / 16, height: 5 / 16, depth: 3 / 16 });
  expect(state.cowHorn).toMatchObject({ width: 1 / 16, height: 3 / 16, depth: 1 / 16 });
  expect(state.cowUdder).toMatchObject({ width: 4 / 16, height: 6 / 16, depth: 1 / 16 });
  expect(state.cowHasPairOfHorns).toBe(true);
  expect(state.initialAwayDot).toBeGreaterThan(0.9);
  expect(state.panicImmediately).toBeGreaterThanOrEqual(4);
  expect(state.remainingPanic).toBeGreaterThan(1.5);
  expect(state.distance).toBeGreaterThan(2);
  expect(state.movedAway).toBe(true);
});

test("surface jump gives a small breach then falls back", async ({ page }) => {
  await page.goto("/");

  const breach = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 90.5, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.keys.clear();
    game.world.setBlock(0, 89, 0, 3);
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });

    let maxY = game.player.position.y;
    let dippedAfterBreach = false;
    let previousY = game.player.position.y;
    for (let i = 0; i < 36; i += 1) {
      game.player.keys.add("Space");
      game.player.update(0.045);
      maxY = Math.max(maxY, game.player.position.y);
      if (maxY > 91.05 && game.player.position.y < previousY - 0.005) dippedAfterBreach = true;
      previousY = game.player.position.y;
    }

    return {
      maxY,
      finalY: game.player.position.y,
      dippedAfterBreach,
    };
  });

  expect(breach.maxY).toBeGreaterThan(91.6);
  expect(breach.maxY).toBeLessThan(92.8);
  expect(breach.dippedAfterBreach).toBe(true);
});

test("can climb out of water at a shore edge", async ({ page }) => {
  await page.goto("/");

  const exit = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 90.1, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.yaw = 0;
    game.player.keys.clear();
    game.world.setBlock(0, 89, 0, 3);
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });
    for (let z = -1; z >= -4; z -= 1) {
      game.world.setBlock(0, 90, z, 3);
      game.world.setBlock(0, 91, z, 0);
      game.world.setBlock(0, 92, z, 0);
    }

    for (let i = 0; i < 28; i += 1) {
      game.player.keys.add("KeyW");
      game.player.keys.add("Space");
      game.player.update(0.045);
    }

    return {
      y: game.player.position.y,
      z: game.player.position.z,
      inWater: game.player.inWater,
    };
  });

  expect(exit.y).toBeGreaterThan(91.1);
  expect(exit.z).toBeLessThan(0.35);
  expect(exit.inWater).toBe(false);
});

test("animates idle water surface vertices", async ({ page }) => {
  await page.goto("/");

  const wave = await page.evaluate(() => {
    const game = window.__game;
    game.world.setBlock(4, 90, 4, 20, { waterLevel: 0 });
    game.world.ensureChunksAround(game.player.position, 1, 9);
    const mesh = [...game.world.chunks.values()].find((chunk) => chunk.waterMesh)?.waterMesh;
    const position = mesh.geometry.getAttribute("position");
    const waterWave = mesh.geometry.getAttribute("waterWave");
    const index = Array.from({ length: waterWave.count }, (_, i) => i).find((i) => waterWave.getX(i) > 0);
    const before = position.getY(index);
    game.animateWater(2.5);
    const after = position.getY(index);
    const frameBefore = mesh.material.map.userData.frame;
    game.animateWater(3.1);
    const frameAfter = mesh.material.map.userData.frame;
    const offsetX = mesh.material.map.offset.x;
    const offsetY = mesh.material.map.offset.y;
    return { before, after, frameBefore, frameAfter, offsetX, offsetY };
  });

  expect(wave.after).not.toBeCloseTo(wave.before, 5);
  expect(wave.frameAfter).not.toBe(wave.frameBefore);
  expect(Math.abs(wave.frameAfter - wave.frameBefore)).toBeLessThanOrEqual(4);
  expect(wave.offsetX).toBe(0);
  expect(wave.offsetY).toBe(0);
});

test("holding space at the water surface bobs instead of launching", async ({ page }) => {
  await page.goto("/");

  const bob = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 90.5, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.keys.clear();
    game.player.waterBreachCooldown = 0;
    game.player.waterBreachCoast = 0;
    game.player.waterBreachLocked = false;
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 89, 0, 3);

    const samples = [];
    const triggers = [];
    for (let i = 0; i < 90; i += 1) {
      const wasLocked = game.player.waterBreachLocked;
      const preOffset = game.player.waterSurfaceOffset(1.25);
      game.player.keys.add("Space");
      game.player.update(0.045);
      if (!wasLocked && game.player.waterBreachLocked) triggers.push(preOffset);
      samples.push(game.player.position.y);
    }

    const firstPeak = Math.max(...samples.slice(0, 16));
    const firstDip = Math.min(...samples.slice(16, 32));
    const secondPeak = Math.max(...samples.slice(30, 50));

    return {
      firstPeak,
      firstDip,
      secondPeak,
      firstTriggerOffset: triggers[0],
      velocityY: game.player.velocity.y,
    };
  });

  expect(bob.firstTriggerOffset).toBeGreaterThan(0.03);
  expect(bob.firstTriggerOffset).toBeLessThan(0.16);
  expect(bob.firstPeak).toBeGreaterThan(91.7);
  expect(bob.firstPeak - bob.firstDip).toBeGreaterThan(0.7);
  expect(bob.secondPeak - bob.firstDip).toBeGreaterThan(0.6);
});

test("spamming space at the water surface does not trigger breach hopping", async ({ page }) => {
  await page.goto("/");

  const spam = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 91.82, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.keys.clear();
    game.player.waterBreachCooldown = 0;
    game.player.waterBreachCoast = 0;
    game.player.waterBreachLocked = false;
    game.player.waterJumpHoldTime = 0;
    game.player.waterTapSuppress = 0;
    game.world.setBlock(0, 89, 0, 3);
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });

    const samples = [];
    let breaches = 0;
    for (let i = 0; i < 90; i += 1) {
      const wasLocked = game.player.waterBreachLocked;
      if (i % 3 === 0) game.player.handleKeyDown("Space");
      if (i % 3 === 1) game.player.handleKeyUp("Space");
      game.player.update(0.045);
      if (!wasLocked && game.player.waterBreachLocked) breaches += 1;
      samples.push(game.player.position.y);
    }

    return {
      breaches,
      minY: Math.min(...samples),
      maxY: Math.max(...samples),
    };
  });

  expect(spam.breaches).toBe(0);
  expect(spam.maxY).toBeLessThan(92.08);
  expect(spam.maxY - spam.minY).toBeLessThan(0.3);
});

test("space underwater against a wall does not teleport to the top", async ({ page }) => {
  await page.goto("/");

  const movement = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 90.1, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.yaw = 0;
    game.player.keys.clear();
    game.world.setBlock(0, 89, 0, 3);
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 92, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 90, -1, 3);
    game.world.setBlock(0, 91, -1, 3);
    game.world.setBlock(0, 92, -1, 3);

    for (let i = 0; i < 8; i += 1) {
      game.player.keys.add("KeyW");
      game.player.keys.add("Space");
      game.player.update(0.045);
    }

    return {
      y: game.player.position.y,
      z: game.player.position.z,
    };
  });

  expect(movement.y).toBeLessThan(92.2);
  expect(movement.z).toBeGreaterThan(-0.35);
});

test("partly surfaced swimming into a wall does not step up instantly", async ({ page }) => {
  await page.goto("/");

  const movement = await page.evaluate(() => {
    const game = window.__game;
    game.player.position.set(0.5, 90.72, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.mode = "survival";
    game.player.yaw = 0;
    game.player.keys.clear();
    game.world.setBlock(0, 89, 0, 3);
    game.world.setBlock(0, 90, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 91, 0, 20, { waterLevel: 0 });
    game.world.setBlock(0, 90, -1, 3);
    game.world.setBlock(0, 91, -1, 3);
    game.world.setBlock(0, 92, -1, 3);

    for (let i = 0; i < 10; i += 1) {
      game.player.keys.add("KeyW");
      game.player.keys.add("Space");
      game.player.update(0.045);
    }

    return {
      y: game.player.position.y,
      z: game.player.position.z,
      eyeInWater: game.player.eyeInWater,
    };
  });

  expect(movement.y).toBeLessThan(92.8);
  expect(movement.z).toBeGreaterThan(-0.35);
});

test("floor corners darken between two adjacent walls", async ({ page }) => {
  await page.goto("/");

  const shadow = await page.evaluate(() => {
    const game = window.__game;
    const y = 180;
    for (let x = 8; x <= 12; x += 1) {
      for (let z = 8; z <= 12; z += 1) {
        for (let clearY = y; clearY <= y + 3; clearY += 1) game.world.setBlock(x, clearY, z, 0);
      }
    }
    game.world.setBlock(10, y, 10, 3);
    game.world.setBlock(11, y + 1, 10, 3);
    game.world.setBlock(10, y + 1, 11, 3);
    const cornerShadow = window.__gameDebug.getTopFaceContactShadow(game.world, 10, y, 10, [1, 1, 1]);
    const openShadow = window.__gameDebug.getTopFaceContactShadow(game.world, 10, y, 10, [0, 1, 0]);
    return { cornerShadow, openShadow };
  });

  expect(shadow.cornerShadow).toBeLessThan(shadow.openShadow);
  expect(shadow.cornerShadow).toBeLessThan(0.52);
});

test("uses the bottom inventory row as the real hotbar", async ({ page }) => {
  test.setTimeout(70000);
  await page.goto("/");
  await startGame(page);
  await page.keyboard.press("KeyE");

  const inventoryState = await page.evaluate(() => {
    const game = window.__game;
    game.inventory = new game.inventory.constructor();
    game.inventory.addItem("cactus", 3);
    game.inventory.slots[0] = { id: "stone", count: 2 };
    game.renderInventory();

    return {
      pickupSlot: game.inventory.slots[27],
      hotbarSprite: document.querySelector(".hotbar-slot[data-index='0']").style.getPropertyValue("--slot-image"),
      inventoryHotbarMarked: document
        .querySelector('[data-area="inventory"][data-index="27"]')
        .classList.contains("is-hotbar-slot"),
    };
  });

  expect(inventoryState.pickupSlot).toEqual({ id: "cactus", count: 3 });
  expect(inventoryState.hotbarSprite).toContain("data:image/png");
  expect(inventoryState.inventoryHotbarMarked).toBe(true);

  await page.locator('[data-area="inventory"][data-index="0"]').click({ modifiers: ["Shift"] });

  await expect.poll(async () => {
    return page.evaluate(() => ({
      topSlot: window.__game.inventory.slots[0],
      hotbarSlot: window.__game.inventory.slots[28],
    }));
  }).toEqual({
    topSlot: null,
    hotbarSlot: { id: "stone", count: 2 },
  });

  await page.evaluate(() => {
    const game = window.__game;
    game.inventory.slots[0] = { id: "sand", count: 1 };
    game.inventory.slots[27] = { id: "dirt", count: 1 };
    game.renderInventory();
  });
  await page.locator('[data-area="inventory"][data-index="0"]').hover();
  await page.keyboard.press("Digit1");

  await expect.poll(() => page.evaluate(() => ({
    topSlot: window.__game.inventory.slots[0],
    hotbarSlot: window.__game.inventory.slots[27],
  }))).toEqual({
    topSlot: { id: "dirt", count: 1 },
    hotbarSlot: { id: "sand", count: 1 },
  });
});

test("generates distinct desert, taiga, and jungle surface blocks", async ({ page }) => {
  await page.goto("/");

  const biomes = await page.evaluate(() => {
    const game = window.__game;
    const samples = {
      desert: { x: 4016, z: -528, topBlock: 4 },
      taiga: { x: 1024, z: -4048, topBlock: 11 },
      jungle: { x: 3312, z: -3760, topBlock: 1 },
    };
    const found = {};

    for (const [name, sample] of Object.entries(samples)) {
      const biome = game.world.biomeAt(sample.x, sample.z);
      const y = game.world.terrainHeight(sample.x, sample.z);
      const topBlock = game.world.surfaceBlocksFor(sample.x, sample.z, y, biome).top;
      found[name] = {
        biome,
        x: sample.x,
        z: sample.z,
        y,
        topBlock,
      };
    }

    return found;
  });

  expect(biomes.desert?.biome).toBe("desert");
  expect(biomes.desert?.topBlock).toBe(4);
  expect(biomes.taiga?.biome).toBe("taiga");
  expect(biomes.taiga?.topBlock).toBe(11);
  expect(biomes.jungle?.biome).toBe("jungle");
  expect(biomes.jungle?.topBlock).toBe(1);
});

test("registers new block set and 16px atlas textures", async ({ page }) => {
  await page.goto("/");

  const debug = await page.evaluate(() => ({
    blockNames: window.__gameDebug.getBlockNames(),
    atlasTileSize: window.__gameDebug.getBlockAtlasTileSize(),
    leafAlpha: window.__gameDebug.getAtlasAlphaStats("leaves"),
    stoneAlpha: window.__gameDebug.getAtlasAlphaStats("stone"),
  }));

  for (const name of [
    "Gravel",
    "Cobblestone",
    "Coal Ore",
    "Iron Ore",
    "Copper Ore",
    "Gold Ore",
    "Diamond Ore",
    "Red Sand",
    "Terracotta",
    "White Terracotta",
    "Snowy Grass",
    "Snow",
    "Birch Log",
    "Birch Leaves",
    "Moss",
    "Meadow Grass",
    "Dry Grass",
    "Acacia Log",
    "Acacia Leaves",
    "Limestone",
    "Basalt",
    "Slate",
    "Tall Grass",
    "Granite",
    "Diorite",
    "Andesite",
    "Deepslate",
    "Ice",
    "Packed Ice",
    "Dandelion",
    "Poppy",
    "Blue Orchid",
    "Dead Bush",
    "Berry Bush",
    "Sugar Cane",
    "Pumpkin",
    "Melon",
    "Vine",
    "Coarse Dirt",
    "Savanna Grass",
    "Clover",
    "Savanna Shrub",
  ]) {
    expect(debug.blockNames).toContain(name);
  }
  expect(debug.atlasTileSize).toBe(16);
  expect(debug.leafAlpha.transparent).toBeGreaterThan(0);
  expect(debug.leafAlpha.opaque).toBeGreaterThan(0);
  expect(debug.leafAlpha.transparent + debug.leafAlpha.opaque).toBe(debug.leafAlpha.pixels);
  expect(debug.stoneAlpha.transparent).toBe(0);
});

test("keeps creative inventory to real items and untinted dropped sprites", async ({ page }) => {
  await page.goto("/");

  const debug = await page.evaluate(() => ({
    creativeItems: window.__gameDebug.getCreativeItems(),
    diamondDrop: window.__gameDebug.getDroppedItemMaterialState("diamond"),
  }));
  const creativeById = Object.fromEntries(debug.creativeItems.map((item) => [item.id, item.name]));
  const creativeNames = debug.creativeItems.map((item) => item.name.toLowerCase());

  for (const id of [
    "empty_armor_slot_boots",
    "empty_armor_slot_chestplate",
    "empty_armor_slot_helmet",
    "empty_armor_slot_leggings",
    "grass_side_snowed",
    "snow_grass",
    "jungle_grass",
    "meadow_grass",
    "dry_grass",
    "savanna_grass",
    "quiver",
    "ruby",
  ]) {
    expect(creativeById[id]).toBeUndefined();
  }

  expect(creativeNames.some((name) => name.includes("grass side snowed"))).toBe(false);
  expect(creativeById.grass).toBe("Grass Block");
  expect(creativeById.door_wood).toBe("Oak Door");
  expect(creativeById.planks_oak).toBe("Oak Planks");
  expect(creativeById.armor_stand).toBe("Armor Stand");
  expect(debug.diamondDrop).toMatchObject({
    color: 0xffffff,
    hasMap: true,
    transparent: true,
  });
  expect(debug.diamondDrop.alphaTest).toBeGreaterThanOrEqual(0.1);
});

test("generates Minecraft 26.2 multi-noise biomes with natural plant life", async ({ page }) => {
  await page.goto("/");

  const world = await page.evaluate(() => {
    const game = window.__game;
    const foundBiomes = new Set();
    const officialBiomes = new Set();
    const foundPlants = new Set();
    const foundTrees = new Set();
    let plants = 0;
    const oceanBiomes = new Set(["ocean", "deep_ocean", "frozen_ocean"]);
    let highLandOceanColumns = 0;
    let highestDesert = -Infinity;

    for (let z = -2048; z <= 2048; z += 32) {
      for (let x = -2048; x <= 2048; x += 32) {
        const biome = game.world.biomeAt(x, z);
        const officialBiome = game.world.generator.minecraft26BiomeIdAt(x, z);
        const height = game.world.terrainHeight(x, z);
        foundBiomes.add(biome);
        officialBiomes.add(officialBiome);
        if (height > 65 && oceanBiomes.has(biome)) highLandOceanColumns += 1;
        if (officialBiome === "desert") highestDesert = Math.max(highestDesert, height);
        const plant = game.world.plantTypeAt(x, z);
        if (plant) {
          plants += 1;
          foundPlants.add(plant);
        }
        const tree = game.world.treeTypeAt(x, z);
        if (tree) foundTrees.add(tree);
      }
    }

    let plains = 0;
    let plainsPlants = 0;
    let tallGrass = 0;
    for (let z = -1632; z < -1568; z += 1) {
      for (let x = -800; x < -736; x += 1) {
        if (game.world.biomeAt(x, z) !== "plains" || game.world.terrainHeight(x, z) <= 63) continue;
        plains += 1;
        const plant = game.world.plantTypeAt(x, z);
        if (plant) plainsPlants += 1;
        if (plant === "tall_grass") tallGrass += 1;
      }
    }

    return {
      biomes: [...foundBiomes],
      officialBiomes: [...officialBiomes],
      plantTypes: [...foundPlants],
      trees: [...foundTrees],
      plantCount: plants,
      highLandOceanColumns,
      highestDesert,
      plains,
      plainsPlantCoverage: plainsPlants / Math.max(1, plains),
      plainsTallGrassCoverage: tallGrass / Math.max(1, plains),
    };
  });

  expect(world.biomes).toEqual(expect.arrayContaining([
    "birch_forest",
    "forest",
    "savanna",
    "plains",
    "taiga",
    "grove",
    "jagged_peaks",
  ]));
  expect(world.officialBiomes).toEqual(expect.arrayContaining([
    "cold_ocean",
    "deep_ocean",
    "forest",
    "plains",
    "taiga",
  ]));
  expect(world.officialBiomes.length).toBeGreaterThanOrEqual(20);
  expect(world.highLandOceanColumns).toBe(0);
  expect(world.highestDesert).toBeLessThan(96);
  expect(world.plains).toBe(4096);
  expect(world.plainsPlantCoverage).toBeGreaterThan(0.4);
  expect(world.plainsTallGrassCoverage).toBeGreaterThan(0.3);
  expect(world.plantTypes).toEqual(expect.arrayContaining(["dandelion", "poppy", "tall_grass"]));
  expect(world.trees).toEqual(expect.arrayContaining(["oak", "spruce", "birch"]));
  expect(world.plantCount).toBeGreaterThan(10);
});

test("keeps dry biomes free of normal grass plants", async ({ page }) => {
  await page.goto("/");

  const dryPlants = await page.evaluate(() => {
    const game = window.__game;
    const dryBiomes = new Set([
      "desert",
      "desert_hills",
      "desert_m",
      "mesa",
      "mesa_bryce",
      "mesa_plateau",
      "mesa_plateau_f",
      "mesa_plateau_m",
      "mesa_plateau_f_m",
    ]);
    const badPlants = new Set();
    let drySamples = 0;

    // The official 26.2 climate map puts this seed's nearest large hot/dry
    // province east of spawn, rather than forcing every biome near (0, 0).
    for (let z = -1600; z <= 512; z += 16) {
      for (let x = 3072; x <= 4608; x += 16) {
        const biome = game.world.biomeAt(x, z);
        if (!dryBiomes.has(biome)) continue;
        drySamples += 1;
        const plant = game.world.plantTypeAt(x, z);
        if (plant && plant !== "dead_bush" && plant !== "sugar_cane") {
          badPlants.add(`${biome}:${plant}`);
        }
      }
    }

    return { drySamples, badPlants: [...badPlants] };
  });

  expect(dryPlants.drySamples).toBeGreaterThan(20);
  expect(dryPlants.badPlants).toEqual([]);
});

test("keeps savanna and flower biome generation on legacy blocks", async ({ page }) => {
  await page.goto("/");

  const variety = await page.evaluate(() => {
    const game = window.__game;
    const savannaBiomes = new Set(["savanna", "savanna_plateau", "savanna_m", "savanna_plateau_m"]);
    const savannaBlocks = new Set();
    const flowerBlocks = new Set();
    const plants = new Set();
    const trees = new Set();
    let rocks = 0;

    const flowerSample = { x: 1472, z: -1856 };
    const flowerBiome = game.world.biomeAt(flowerSample.x, flowerSample.z);
    const flowerY = game.world.terrainHeight(flowerSample.x, flowerSample.z);
    flowerBlocks.add(game.world.surfaceBlocksFor(flowerSample.x, flowerSample.z, flowerY, flowerBiome).top);

    for (let z = -2048; z <= 2048; z += 16) {
      for (let x = -2048; x <= 2048; x += 16) {
        const biome = game.world.biomeAt(x, z);
        const y = game.world.terrainHeight(x, z);
        if (y <= 65) continue;

        if (savannaBiomes.has(biome)) {
          savannaBlocks.add(game.world.surfaceBlocksFor(x, z, y, biome).top);
        }
        if (biome === "flower_forest" || biome === "sunflower_plains") {
          flowerBlocks.add(game.world.surfaceBlocksFor(x, z, y, biome).top);
        }

        const plant = game.world.plantTypeAt(x, z);
        if (plant) plants.add(plant);
        const tree = game.world.treeTypeAt(x, z);
        if (tree) trees.add(tree);
        if (game.world.rockTypeAt(x, z)) rocks += 1;
      }
    }

    return {
      savannaBlocks: [...savannaBlocks],
      flowerBlocks: [...flowerBlocks],
      plants: [...plants],
      trees: [...trees],
      rocks,
    };
  });

  for (const modernBlock of [12, 35, 38, 39, 42, 46, 47, 48, 49, 62]) {
    expect(variety.savannaBlocks).not.toContain(modernBlock);
    expect(variety.flowerBlocks).not.toContain(modernBlock);
  }
  expect(variety.savannaBlocks).toContain(1);
  expect(variety.flowerBlocks).toContain(1);
  expect(variety.plants).toEqual(expect.arrayContaining(["poppy", "dead_bush", "tall_grass"]));
  for (const modernPlant of ["wildflower", "clover", "berry_bush", "savanna_shrub"]) {
    expect(variety.plants).not.toContain(modernPlant);
  }
  expect(variety.rocks).toBeGreaterThan(0);
});

test("keeps terrain coherent while allowing cliffs", async ({ page }) => {
  await page.goto("/");

  const terrain = await page.evaluate(() => {
    const game = window.__game;
    let maxDiff = 0;
    let cliffEdges = 0;
    let ruggedEdges = 0;
    let isolatedPits = 0;
    let maxDiffAt = null;

    for (let z = -96; z < 96; z += 1) {
      for (let x = -96; x < 96; x += 1) {
        const height = game.world.terrainHeight(x, z);
        const neighbors = [
          game.world.terrainHeight(x + 1, z),
          game.world.terrainHeight(x - 1, z),
          game.world.terrainHeight(x, z + 1),
          game.world.terrainHeight(x, z - 1),
        ];
        const localMaxDiff = Math.max(...neighbors.map((neighbor) => Math.abs(height - neighbor)));
        if (localMaxDiff > maxDiff) {
          maxDiff = localMaxDiff;
          maxDiffAt = { x, z, height, neighbors, biome: game.world.biomeAt(x, z) };
        }
        for (const neighbor of neighbors) {
          const diff = Math.abs(height - neighbor);
          if (diff >= 4) cliffEdges += 1;
          if (diff >= 8) ruggedEdges += 1;
        }
        if (neighbors.every((neighbor) => neighbor - height >= 3)) isolatedPits += 1;
      }
    }

    return { maxDiff, maxDiffAt, cliffEdges, ruggedEdges, isolatedPits };
  });

  expect(terrain.maxDiff).toBeLessThanOrEqual(14);
  expect(terrain.isolatedPits).toBe(0);
});

test("avoids repeated terrace waves and extreme one-block spikes", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");

  const terrain = await page.evaluate(() => {
    const game = window.__game;
    let samples = 0;
    let oneBlockRuns = 0;
    let longOneBlockRuns = 0;
    let extremeEdges = 0;
    let highColumns = 0;
    let isolatedHighSpikes = 0;
    let landColumns = 0;
    let evenLandColumns = 0;

    for (let z = -2048; z <= 2048; z += 32) {
      let run = 0;
      let previous = null;
      let previousPrevious = null;
      for (let x = -2048; x <= 2048; x += 1) {
        const height = game.world.terrainHeight(x, z);
        if (height >= 110) highColumns += 1;
        if (height > 66) {
          landColumns += 1;
          if ((height & 1) === 0) evenLandColumns += 1;
        }
        if (previous !== null) {
          const diff = Math.abs(height - previous);
          samples += 1;
          if (diff >= 7) extremeEdges += 1;
          if (
            previousPrevious !== null &&
            previous >= 110 &&
            previous - Math.max(previousPrevious, height) >= 5 &&
            Math.abs(previousPrevious - height) <= 3
          ) {
            isolatedHighSpikes += 1;
          }
          if (diff === 1) {
            run += 1;
            oneBlockRuns += 1;
            if (run >= 14) longOneBlockRuns += 1;
          } else {
            run = 0;
          }
        }
        previousPrevious = previous;
        previous = height;
      }
    }

    return {
      samples,
      oneBlockRunRatio: oneBlockRuns / samples,
      longOneBlockRuns,
      extremeEdges,
      highColumns,
      isolatedHighSpikes,
      landColumns,
      evenLandRatio: evenLandColumns / Math.max(1, landColumns),
    };
  });

  // One-block slopes are normal voxel terrain. The actual regression was the
  // generator forcing nearly every land height onto an even Y level. Coherent
  // contour slopes now intentionally replace block-scale random height dither.
  expect(terrain.oneBlockRunRatio).toBeLessThan(0.40);
  expect(terrain.longOneBlockRuns).toBeLessThan(3000);
  // Modern mountain bands may contain rare coherent cliffs; the companion
  // coherence test rejects isolated pits/spikes and caps the maximum edge.
  expect(terrain.extremeEdges / terrain.samples).toBeLessThan(0.005);
  expect(terrain.highColumns).toBeGreaterThan(50);
  expect(terrain.isolatedHighSpikes).toBeLessThan(40);
  expect(terrain.landColumns).toBeGreaterThan(1000);
  expect(terrain.evenLandRatio).toBeGreaterThan(0.42);
  expect(terrain.evenLandRatio).toBeLessThan(0.58);
});

test("keeps inland lowlands dry instead of making tiny clay ponds", async ({ page }) => {
  await page.goto("/");

  const terrain = await page.evaluate(() => {
    const game = window.__game;
    let dryBelowSea = 0;
    let dryClay = 0;

    for (let z = -512; z <= 512; z += 8) {
      for (let x = -512; x <= 512; x += 8) {
        const height = game.world.terrainHeight(x, z);
        const fillsWater = game.world.shouldFillWaterAt(x, z, height);
        const biome = game.world.biomeAt(x, z);
        const surface = game.world.surfaceBlocksFor(x, z, height, biome);
        if (height < 63 && !fillsWater) dryBelowSea += 1;
        if (surface.top === 8 && !fillsWater) dryClay += 1;
      }
    }

    return { dryBelowSea, dryClay };
  });

  expect(terrain).toEqual({ dryBelowSea: 0, dryClay: 0 });
});

test("keeps low shorelines from forming a repeated two-block sea ledge", async ({ page }) => {
  await page.goto("/");

  const shore = await page.evaluate(() => {
    const game = window.__game;
    let adjacentLowBanks = 0;
    let tallLowBanks = 0;

    for (let z = -512; z <= 512; z += 4) {
      for (let x = -512; x <= 512; x += 4) {
        const height = game.world.terrainHeight(x, z);
        if (!game.world.shouldFillWaterAt(x, z, height)) continue;

        for (const [dx, dz] of [
          [4, 0],
          [-4, 0],
          [0, 4],
          [0, -4],
        ]) {
          const bankHeight = game.world.terrainHeight(x + dx, z + dz);
          const bankFillsWater = game.world.shouldFillWaterAt(x + dx, z + dz, bankHeight);
          if (bankFillsWater || bankHeight > 66) continue;
          adjacentLowBanks += 1;
          if (bankHeight - 63 >= 2) tallLowBanks += 1;
        }
      }
    }

    return { adjacentLowBanks, tallLowBanks };
  });

  expect(shore.adjacentLowBanks).toBeGreaterThan(20);
  expect(shore.tallLowBanks / shore.adjacentLowBanks).toBeLessThan(0.25);
});

test("keeps beaches narrow, exposes rivers, and keeps swamps wet but grassy on banks", async ({ page }) => {
  await page.goto("/");

  const terrain = await page.evaluate(() => {
    const game = window.__game;
    const desertBiomes = new Set(["desert", "desert_hills", "desert_m", "mesa", "mesa_plateau", "mesa_plateau_f"]);
    let drySandAwayFromShore = 0;
    let edgeHills = 0;
    let rivers = 0;
    let swampSamples = 0;
    let swampWet = 0;
    let swampWetFloor = 0;
    let swampDryGrass = 0;
    let swampMuddyBank = 0;
    let swampWrongSurface = 0;

    for (let z = -1536; z <= 1536; z += 32) {
      for (let x = -1536; x <= 1536; x += 32) {
        const height = game.world.terrainHeight(x, z);
        const shape = game.world.terrainShapeAt(x, z);
        const biome = game.world.biomeAt(x, z);
        const fillsWater = game.world.shouldFillWaterAt(x, z, height);
        const surface = game.world.surfaceBlocksFor(x, z, height, biome);
        const shoreline = game.world.generator.isShorelineAt(x, z, shape, height);

        if (biome === "river" || biome === "frozen_river") rivers += 1;
        if (biome === "extreme_hills_edge") edgeHills += 1;
        if (!fillsWater && surface.top === 4 && !shoreline && !desertBiomes.has(biome)) drySandAwayFromShore += 1;
        if (biome === "swampland" || biome === "swampland_m") {
          swampSamples += 1;
          if (fillsWater) {
            swampWet += 1;
            if ((surface.top === 2 || surface.top === 8) && (surface.filler === 2 || surface.filler === 8)) swampWetFloor += 1;
            else swampWrongSurface += 1;
          } else if (surface.top === 1 && surface.filler === 2) {
            swampDryGrass += 1;
          } else if (height <= 64 && surface.top === 2 && surface.filler === 2) {
            swampMuddyBank += 1;
          } else {
            swampWrongSurface += 1;
          }
        }
      }
    }

    // Swamps are broad climate provinces in the official source; this seed's
    // nearest one is east of the spawn-centered shore/river sample above.
    for (let z = -1024; z <= 1024; z += 16) {
      for (let x = 2048; x <= 3072; x += 16) {
        const biome = game.world.biomeAt(x, z);
        if (biome !== "swampland" && biome !== "swampland_m") continue;
        const height = game.world.terrainHeight(x, z);
        const fillsWater = game.world.shouldFillWaterAt(x, z, height);
        const surface = game.world.surfaceBlocksFor(x, z, height, biome);
        swampSamples += 1;
        if (fillsWater) {
          swampWet += 1;
          if ((surface.top === 2 || surface.top === 8) && (surface.filler === 2 || surface.filler === 8)) swampWetFloor += 1;
          else swampWrongSurface += 1;
        } else if (surface.top === 1 && surface.filler === 2) {
          swampDryGrass += 1;
        } else if (height <= 64 && surface.top === 2 && surface.filler === 2) {
          swampMuddyBank += 1;
        } else {
          swampWrongSurface += 1;
        }
      }
    }

    return { drySandAwayFromShore, edgeHills, rivers, swampSamples, swampWet, swampWetFloor, swampDryGrass, swampMuddyBank, swampWrongSurface };
  });

  expect(terrain.drySandAwayFromShore).toBe(0);
  expect(terrain.edgeHills).toBeLessThan(20);
  expect(terrain.rivers).toBeGreaterThan(20);
  expect(terrain.rivers).toBeLessThan(700);
  expect(terrain.swampSamples).toBeGreaterThan(0);
  expect(terrain.swampWet).toBeGreaterThan(0);
  expect(terrain.swampWetFloor).toBe(terrain.swampWet);
  expect(terrain.swampDryGrass + terrain.swampMuddyBank).toBeGreaterThan(0);
  expect(terrain.swampWrongSurface).toBe(0);
});

test("generates patchy shallow swamp water and vegetation like minecraft", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");

  const swamp = await page.evaluate(() => {
    const game = window.__game;
    const waterLevel = game.world.waterLevel ?? 63;
    const swampBiomes = new Set(["swampland", "swampland_m"]);
    let samples = 0;
    let wet = 0;
    let shallowWet = 0;
    let wetFloor = 0;
    let dryBanks = 0;
    let highColumns = 0;
    let trees = 0;
    let waterlilies = 0;
    let orchids = 0;
    let cane = 0;
    let mushrooms = 0;
    let grasses = 0;
    let boundaryChecks = 0;
    let boundaryBigDrops = 0;
    let boundaryHugeDrops = 0;

    for (let z = -4096; z <= 4096; z += 16) {
      for (let x = -4096; x <= 4096; x += 16) {
        const biome = game.world.biomeAt(x, z);
        if (!swampBiomes.has(biome)) continue;

        samples += 1;
        const height = game.world.terrainHeight(x, z);
        const fillsWater = game.world.shouldFillWaterAt(x, z, height);
        const surface = game.world.surfaceBlocksFor(x, z, height, biome);
        const plant = game.world.plantTypeAt(x, z);
        const tree = game.world.treeTypeAt(x, z);

        if (fillsWater) {
          wet += 1;
          if (height >= waterLevel - 4) shallowWet += 1;
          if ((surface.top === 2 || surface.top === 8) && (surface.filler === 2 || surface.filler === 8)) wetFloor += 1;
        } else if (height <= waterLevel + 4 && ((surface.top === 1 && surface.filler === 2) || (surface.top === 2 && surface.filler === 2))) {
          dryBanks += 1;
        }
        if (height > waterLevel + 10) highColumns += 1;
        if (tree === "swamp_oak") trees += 1;
        if (plant === "waterlily") waterlilies += 1;
        if (plant === "blue_orchid") orchids += 1;
        if (plant === "sugar_cane") cane += 1;
        if (plant === "brown_mushroom" || plant === "red_mushroom") mushrooms += 1;
        if (plant === "tall_grass") grasses += 1;

        for (const [dx, dz] of [
          [16, 0],
          [-16, 0],
          [0, 16],
          [0, -16],
        ]) {
          const neighborBiome = game.world.biomeAt(x + dx, z + dz);
          if (swampBiomes.has(neighborBiome)) continue;
          const neighborHeight = game.world.terrainHeight(x + dx, z + dz);
          const drop = Math.abs(neighborHeight - height);
          boundaryChecks += 1;
          if (drop > 10) boundaryBigDrops += 1;
          if (drop > 18) boundaryHugeDrops += 1;
        }
      }
    }

    return {
      samples,
      wet,
      shallowWet,
      wetFloor,
      dryBanks,
      highColumns,
      trees,
      waterlilies,
      orchids,
      cane,
      mushrooms,
      grasses,
      boundaryChecks,
      boundaryBigDrops,
      boundaryHugeDrops,
    };
  });

  expect(swamp.samples).toBeGreaterThan(100);
  expect(swamp.wet / swamp.samples).toBeGreaterThan(0.12);
  expect(swamp.wet / swamp.samples).toBeLessThan(0.35);
  expect(swamp.shallowWet / swamp.wet).toBeGreaterThan(0.5);
  expect(swamp.wetFloor).toBe(swamp.wet);
  expect(swamp.dryBanks).toBeGreaterThan(0);
  expect(swamp.highColumns / swamp.samples).toBeLessThan(0.18);
  expect(swamp.boundaryBigDrops / swamp.boundaryChecks).toBeLessThan(0.2);
  expect(swamp.boundaryHugeDrops / swamp.boundaryChecks).toBeLessThan(0.03);
  expect(swamp.trees).toBeGreaterThan(0);
  expect(swamp.waterlilies).toBeGreaterThan(0);
  expect(swamp.orchids).toBeGreaterThan(0);
  expect(swamp.cane).toBeGreaterThan(0);
  expect(swamp.mushrooms).toBeGreaterThan(0);
  expect(swamp.grasses).toBeGreaterThan(0);
});

test("samples minecraft-style climate, caves, aquifers, and ore veins", async ({ page }) => {
  await page.goto("/");

  const generation = await page.evaluate(() => {
    const game = window.__game;
    const climate = game.world.climateAt(96, -128);
    let caves = 0;
    let isolatedCaves = 0;
    let clearCaveNeighborhoods = 0;
    let surfaceCaves = 0;
    let ravines = 0;
    let aquifers = 0;
    let oreVeins = 0;
    let generatedCommonOres = 0;
    let isolatedCommonOres = 0;

    for (let z = -384; z <= 384; z += 8) {
      for (let x = -384; x <= 384; x += 8) {
        const surfaceHeight = game.world.terrainHeight(x, z);
        if (
          game.world.surfaceCaveMouthStrength(x, z, surfaceHeight) > 0.2 &&
          game.world.isCaveAt(x, surfaceHeight, z, surfaceHeight)
        ) {
          surfaceCaves += 1;
        }
      }
    }

    for (let z = -384; z <= 384; z += 16) {
      for (let x = -384; x <= 384; x += 16) {
        const surfaceHeight = game.world.terrainHeight(x, z);
        for (let y = 6; y < surfaceHeight - 5; y += 5) {
          if (game.world.isRavineAt(x, y, z, surfaceHeight)) ravines += 1;
          if (game.world.isCaveAt(x, y, z, surfaceHeight)) {
            caves += 1;
            const neighbors = [
              [1, 0, 0],
              [-1, 0, 0],
              [0, 1, 0],
              [0, -1, 0],
              [0, 0, 1],
              [0, 0, -1],
            ].filter(([dx, dy, dz]) => game.world.isCaveAt(x + dx, y + dy, z + dz, surfaceHeight)).length;
            if (neighbors <= 1) isolatedCaves += 1;
            if (neighbors >= 4) clearCaveNeighborhoods += 1;
            if (game.world.aquiferBlockAt(x, y, z, surfaceHeight) === 20) aquifers += 1;
          }
          const ore = game.world.oreBlockAt(x, y, z, surfaceHeight);
          if (ore === 24 || ore === 25) oreVeins += 1;
        }
      }
    }

    for (let cx = 0; cx <= 1; cx += 1) {
      for (let cz = 0; cz <= 1; cz += 1) {
        const chunk = game.world.getChunk(cx, cz);
        for (let x = 1; x < 15; x += 1) {
          for (let z = 1; z < 15; z += 1) {
            for (let y = 1; y < 255; y += 1) {
              const index = chunk.index(x, y, z);
              const ore = chunk.blocks[index];
              if (ore !== 23 && ore !== 24) continue;
              generatedCommonOres += 1;
              const connected = [
                index + 1,
                index - 1,
                index + 16,
                index - 16,
                index + 256,
                index - 256,
              ].some((neighborIndex) => chunk.blocks[neighborIndex] === ore);
              if (!connected) isolatedCommonOres += 1;
            }
          }
        }
      }
    }

    return {
      climate,
      caves,
      isolatedCaves,
      clearCaveNeighborhoods,
      surfaceCaves,
      ravines,
      aquifers,
      oreVeins,
      generatedCommonOres,
      isolatedCommonOres,
    };
  });

  expect(generation.climate).toEqual(expect.objectContaining({
    temperature: expect.any(Number),
    vegetation: expect.any(Number),
    continentalness: expect.any(Number),
    erosion: expect.any(Number),
    weirdness: expect.any(Number),
    peaksAndValleys: expect.any(Number),
    depth: 0,
  }));
  expect(generation.caves).toBeGreaterThan(100);
  expect(generation.isolatedCaves / generation.caves).toBeLessThan(0.18);
  expect(generation.clearCaveNeighborhoods).toBeGreaterThan(20);
  expect(generation.surfaceCaves).toBeGreaterThan(10);
  expect(generation.ravines).toBeGreaterThan(5);
  expect(generation.ravines).toBeLessThan(80);
  expect(generation.aquifers).toBeGreaterThanOrEqual(3);
  expect(generation.aquifers / generation.caves).toBeLessThan(0.22);
  expect(generation.oreVeins).toBeGreaterThan(10);
  expect(generation.generatedCommonOres).toBeGreaterThan(10);
  expect(generation.isolatedCommonOres).toBe(0);
});

test("uses Minecraft 26.2 vertical distributions for every supported overworld ore", async ({ page }) => {
  await page.goto("/");

  const ores = await page.evaluate(() => {
    const game = window.__game;
    const ids = {
      coal: window.__gameDebug.getBlockIdByItemId("coal_ore"),
      iron: window.__gameDebug.getBlockIdByItemId("iron_ore"),
      copper: window.__gameDebug.getBlockIdByItemId("copper_ore"),
      gold: window.__gameDebug.getBlockIdByItemId("gold_ore"),
      diamond: window.__gameDebug.getBlockIdByItemId("diamond_ore"),
      redstone: window.__gameDebug.getBlockIdByItemId("redstone_ore"),
      lapis: window.__gameDebug.getBlockIdByItemId("lapis_ore"),
      emerald: window.__gameDebug.getBlockIdByItemId("emerald_ore"),
    };
    const bands = {
      deepDiamond: 10,
      midDiamond: 26,
      shallowDiamond: 45,
      aboveDiamond: 60,
      goldPeak: 32,
      copperPeak: 75,
      lapisPeak: 53,
      coalPeak: 112,
      highIronPeak: 196,
    };

    const sampleBand = (y) => {
      const counts = { coal: 0, iron: 0, copper: 0, gold: 0, diamond: 0, redstone: 0, lapis: 0, emerald: 0, mcY: window.__gameDebug.getMinecraft118Y(y) };
      for (let z = -256; z <= 256; z += 4) {
        for (let x = -256; x <= 256; x += 4) {
          const block = game.world.oreBlockAt(x, y, z, 255);
          for (const [name, id] of Object.entries(ids)) {
            if (block === id) counts[name] += 1;
          }
        }
      }
      return counts;
    };

    return Object.fromEntries(Object.entries(bands).map(([name, y]) => [name, sampleBand(y)]));
  });

  expect(ores.deepDiamond.mcY).toBeLessThan(-40);
  expect(ores.deepDiamond.diamond).toBeGreaterThan(ores.midDiamond.diamond);
  expect(ores.midDiamond.diamond).toBeGreaterThan(ores.shallowDiamond.diamond);
  expect(ores.shallowDiamond.diamond).toBeGreaterThan(0);
  expect(ores.aboveDiamond.diamond).toBe(0);
  expect(ores.goldPeak.gold).toBeGreaterThan(ores.coalPeak.gold);
  expect(ores.copperPeak.copper).toBeGreaterThan(50);
  expect(ores.deepDiamond.copper).toBe(0);
  expect(ores.deepDiamond.redstone).toBeGreaterThan(ores.aboveDiamond.redstone * 2);
  expect(ores.lapisPeak.lapis).toBeGreaterThan(20);
  expect(ores.highIronPeak.emerald).toBeGreaterThan(0);
  expect(ores.coalPeak.coal).toBeGreaterThan(ores.deepDiamond.coal + 40);
  expect(ores.highIronPeak.iron).toBeGreaterThan(ores.deepDiamond.iron * 5);
});

test("uses minecraft sky light levels for open and covered cells", async ({ page }) => {
  await page.goto("/");

  const light = await page.evaluate(() => {
    const game = window.__game;
    const x = 8;
    const y = 100;
    const z = 8;

    for (let wx = x - 4; wx <= x + 4; wx += 1) {
      for (let wz = z - 4; wz <= z + 4; wz += 1) {
        for (let sy = y; sy < 256; sy += 1) {
          game.world.setBlock(wx, sy, wz, 0);
        }
      }
    }
    const openSky = game.world.getSkyLightLevel(x, y, z);
    for (let wx = x - 3; wx <= x + 3; wx += 1) {
      for (let wz = z - 3; wz <= z + 3; wz += 1) {
        game.world.setBlock(wx, y + 1, wz, 3);
      }
    }

    const chunk = game.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
    const snapshot = chunk.createMeshSnapshot();
    const width = 18;
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const snapshotIndex = y * width * width + (localZ + 1) * width + (localX + 1);

    return {
      openSky,
      coveredSky: game.world.getSkyLightLevel(x, y, z),
      snapshotCanopySky: snapshot.skyLights[snapshotIndex],
      blockLight: game.world.getBlockLightLevel(x, y, z),
      combinedLight: game.world.getCombinedLightLevel(x, y, z),
      levels: window.__gameDebug.getLightLevels(),
    };
  });

  expect(light.openSky).toBe(15);
  expect(light.coveredSky).toBe(0);
  expect(light.snapshotCanopySky).toBeGreaterThanOrEqual(9);
  expect(light.snapshotCanopySky).toBeLessThanOrEqual(11);
  expect(light.blockLight).toBe(0);
  expect(light.combinedLight).toBe(0);
  expect(light.levels).toEqual(expect.objectContaining({
    torch: 14,
    furnace: 13,
    soulTorch: 10,
    redstoneTorch: 7,
    glowstone: 15,
    lava: 15,
    max: 15,
  }));
});

test("lit furnaces emit dimmer-than-torch block light", async ({ page }) => {
  await page.goto("/");

  const light = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    const x = 8;
    const y = 100;
    const z = 8;
    const litFurnace = window.__gameDebug.getBlockIdByItemId("furnace_lit");
    const unlitFurnace = window.__gameDebug.getBlockIdByItemId("furnace");

    for (let wx = x - 4; wx <= x + 4; wx += 1) {
      for (let wz = z - 4; wz <= z + 4; wz += 1) {
        for (let wy = y - 2; wy <= y + 4; wy += 1) world.setBlock(wx, wy, wz, 0);
      }
    }

    world.setBlock(x, y, z, litFurnace);
    const chunk = world.getChunk(0, 0);
    const snapshot = chunk.createMeshSnapshot();
    const width = 18;
    const adjacentIndex = y * width * width + (z + 1) * width + (x + 2);
    world.updateDynamicBlockLights({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1);
    const dynamicLights = window.__gameDebug.getActiveDynamicBlockLights();

    const litLevel = world.getBlockLightLevel(x, y, z);
    world.setBlock(x, y, z, unlitFurnace);

    return {
      litLevel,
      adjacentLevel: snapshot.blockLights[adjacentIndex],
      dynamicIntensity: dynamicLights[0]?.intensity ?? 0,
      torchIntensity: 3.1,
      unlitLevel: world.getBlockLightLevel(x, y, z),
    };
  });

  expect(light.litLevel).toBe(13);
  expect(light.adjacentLevel).toBe(12);
  expect(light.dynamicIntensity).toBeGreaterThan(0);
  expect(light.dynamicIntensity).toBeLessThan(light.torchIntensity);
  expect(light.unlitLevel).toBe(0);
});

test("propagates cave daylight from neighboring chunk entrances", async ({ page }) => {
  await page.goto("/");

  const light = await page.evaluate(() => {
    const game = window.__game;
    const world = game.world;
    const y = 100;
    const z = 8;
    const chunkSize = 16;

    world.ensureChunksAround({ x: 8, z }, 2, 25, { timeBudgetMs: 100 });

    const rawSet = (wx, wy, wz, block) => {
      const chunk = world.getChunk(Math.floor(wx / chunkSize), Math.floor(wz / chunkSize));
      chunk.setLocal(
        ((wx % chunkSize) + chunkSize) % chunkSize,
        wy,
        ((wz % chunkSize) + chunkSize) % chunkSize,
        block,
        null,
        false,
        false,
      );
    };

    for (let wx = -15; wx <= 30; wx += 1) {
      for (let wz = -10; wz <= 26; wz += 1) {
        for (let wy = y - 1; wy < 256; wy += 1) {
          rawSet(wx, wy, wz, 0);
        }
        if (wx <= 23) rawSet(wx, y + 1, wz, 3);
      }
    }

    const chunk = world.getChunk(0, 0);
    const snapshot = chunk.createMeshSnapshot();
    const width = 18;
    const lightAt = (wx, wz) => {
      const localX = ((wx % chunkSize) + chunkSize) % chunkSize;
      const localZ = ((wz % chunkSize) + chunkSize) % chunkSize;
      return snapshot.skyLights[y * width * width + (localZ + 1) * width + (localX + 1)];
    };

    return {
      entrySky: world.getSkyLightLevel(24, y, z),
      edgeTunnelSky: lightAt(15, z),
      deeperTunnelSky: lightAt(10, z),
    };
  });

  expect(light.entrySky).toBe(15);
  expect(light.edgeTunnelSky).toBeGreaterThanOrEqual(5);
  expect(light.edgeTunnelSky).toBeLessThan(light.entrySky);
  expect(light.deeperTunnelSky).toBeGreaterThan(0);
  expect(light.deeperTunnelSky).toBeLessThan(light.edgeTunnelSky);
});

test("matches minecraft standing hitbox, jump, and sneak movement numbers", async ({ page }) => {
  await page.goto("/");

  const physics = await page.evaluate(() => {
    const game = window.__game;
    game.started = true;
    game.player.mode = "survival";
    game.player.keys.clear();
    game.player.position.set(0.5, 50, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.onGround = true;

    for (let x = -2; x <= 2; x += 1) {
      for (let z = -3; z <= 1; z += 1) {
        game.world.setBlock(x, 49, z, 3);
        for (let y = 50; y <= 55; y += 1) game.world.setBlock(x, y, z, 0);
      }
    }

    const startY = game.player.position.y;
    let maxY = startY;
    let landedTick = null;
    game.player.jumpQueued = true;
    for (let tick = 0; tick < 24; tick += 1) {
      game.player.update(1 / 20);
      maxY = Math.max(maxY, game.player.position.y);
      if (tick > 0 && game.player.onGround && landedTick === null) landedTick = tick + 1;
    }

    game.player.position.set(0.5, 50, 0.5);
    game.player.velocity.set(0, 0, 0);
    game.player.onGround = true;
    game.player.keys.clear();
    game.player.yaw = 0;
    game.player.keys.add("KeyW");
    game.player.keys.add("ShiftLeft");
    const startZ = game.player.position.z;
    for (let tick = 0; tick < 20; tick += 1) {
      game.player.update(1 / 20);
    }
    game.world.setBlock(0, 52, 0, 3);

    return {
      jumpHeight: maxY - startY,
      landedTick,
      sneakDistance: Math.abs(game.player.position.z - startZ),
      standingCollisionHeight: game.player.collidesAt(0.5, 50, 0.5, 51.8),
      tooTallCollisionHeight: game.player.collidesAt(0.5, 50, 0.5, 52.1),
    };
  });

  expect(physics.jumpHeight).toBeGreaterThan(1.2);
  expect(physics.jumpHeight).toBeLessThan(1.32);
  expect(physics.landedTick).toBeGreaterThanOrEqual(11);
  expect(physics.landedTick).toBeLessThanOrEqual(14);
  expect(physics.sneakDistance).toBeGreaterThan(1.2);
  expect(physics.sneakDistance).toBeLessThan(1.4);
  expect(physics.standingCollisionHeight).toBe(false);
  expect(physics.tooTallCollisionHeight).toBe(true);
});

test("generates oceans, valleys, and taller peaks in the same world", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");

  const terrain = await page.evaluate(() => {
    const game = window.__game;
    const seaLevel = window.__gameDebug.getSeaLevel();
    const worldHeight = window.__gameDebug.getWorldHeight();
    let lowest = Infinity;
    let highest = -Infinity;
    let waterColumns = 0;
    let peakColumns = 0;
    let highSummitColumns = 0;
    let saddleColumns = 0;
    let ceilingColumns = 0;
    let checkedHighColumns = 0;
    let detachedHighCaps = 0;

    for (let z = -2048; z <= 2048; z += 8) {
      for (let x = -2048; x <= 2048; x += 8) {
        const height = game.world.terrainHeight(x, z);
        const shape = game.world.terrainShapeAt(x, z);
        lowest = Math.min(lowest, height);
        highest = Math.max(highest, height);
        if (height <= seaLevel) waterColumns += 1;
        if (height >= seaLevel + 73) peakColumns += 1;
        if (height >= worldHeight - 16) ceilingColumns += 1;
        if (height >= seaLevel + 87 && shape.summitSignal > 0.4) highSummitColumns += 1;
        if (height >= seaLevel + 42 && height <= seaLevel + 107 && shape.saddleSignal > 0.18) saddleColumns += 1;

        if (height >= seaLevel + 73 && x % 32 === 0 && z % 32 === 0) {
          checkedHighColumns += 1;
          let airGap = 0;
          let maxAirGap = 0;
          for (let y = height; y >= Math.max(1, height - 96); y -= 1) {
            if (game.world.generator.terrainDensityAt(x, y, z) > 0) {
              maxAirGap = Math.max(maxAirGap, airGap);
              airGap = 0;
            } else {
              airGap += 1;
            }
          }
          if (maxAirGap >= 32) detachedHighCaps += 1;
        }
      }
    }

    return {
      lowest,
      highest,
      range: highest - lowest,
      waterColumns,
      peakColumns,
      highSummitColumns,
      saddleColumns,
      ceilingColumns,
      checkedHighColumns,
      detachedHighCaps,
    };
  });

  expect(terrain.lowest).toBeLessThanOrEqual(67);
  expect(terrain.highest).toBeGreaterThanOrEqual(165);
  expect(terrain.range).toBeGreaterThanOrEqual(90);
  expect(terrain.waterColumns).toBeGreaterThan(2000);
  expect(terrain.peakColumns).toBeGreaterThan(500);
  expect(terrain.highSummitColumns).toBeGreaterThan(100);
  expect(terrain.saddleColumns).toBeGreaterThan(200);
  expect(terrain.ceilingColumns / terrain.peakColumns).toBeLessThan(0.04);
  expect(terrain.checkedHighColumns).toBeGreaterThan(20);
  expect(terrain.detachedHighCaps).toBe(0);
});

test("scroll wheel changes selected hotbar slot", async ({ page }) => {
  test.setTimeout(50000);
  await page.goto("/");
  await openCreateWorld(page);
  await page.getByRole("button", { name: /creative/i }).click();
  await startGame(page);

  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => window.__game.selectedHotbar)).toBe(1);

  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.evaluate(() => window.__game.selectedHotbar)).toBe(0);
});
