# Voxel Grove

A small Minecraft-style voxel sandbox built with Three.js and Vite.

## Run

```bash
npm install
npm run desktop
```

That builds the game and opens it in a standalone Voxel Grove window.

For live desktop development, use `npm run desktop:dev`. For browser-only development, `npm run dev` still starts the Vite preview server.

For a friend on Windows, use the double-click launchers:

- `Play Voxel Grove.bat` opens the game.
- `Host Multiplayer Voxel Grove.bat` starts a server and opens the game.
- `Start Dedicated Server.bat` starts only the server.

To make a self-contained Windows installer that does not require Node.js on your friend's computer:

```bash
npm run package:win
```

This bumps the patch version, cleans old release artifacts, builds the newest game files, and creates `Voxel-Grove-Setup-...exe` in `release/`. You can also double-click `Package Voxel Grove.bat`.

Each newer installer replaces the previous installed copy of Voxel Grove. For quick no-install testing, use:

```bash
npm run package:portable
```

## Multiplayer

Start a WebSocket game server:

```bash
npm run server
```

Then run the game, choose `Servers`, and join `ws://127.0.0.1:25565`. Friends on the same network can join with your computer's LAN IP and the same port.

## Built In

- Chunked voxel terrain
- Minecraft Java 26.2 density-router terrain generated from the official release data
- Seeded Perlin-style world generation
- Trees, beaches, clay, custom block colors, and procedural face variation
- Procedural pixel-art block textures and item sprites
- Chunk mesh generation that only emits exposed block faces
- First-person movement, jumping, block breaking, and block placing
- Block cracking overlay while mining in Survival
- Survival and Creative modes
- WebSocket multiplayer server with shared block edits, chat, and remote player avatars
- Survival item drops, mining timers, inventory, and 2x2 crafting
- Hotbar selection with number keys 1-8

## Controls

- `WASD` move
- `Space` jump
- `Ctrl` sprint
- `E` inventory
- Mouse wheel changes hotbar slot
- Left mouse mines or breaks
- Right mouse places
- Right-click inventory slots splits stacks

## Minecraft Java 26.2 worldgen data

The terrain implementation is original JavaScript and uses the MIT-licensed `deepslate`
worldgen primitives. Mojang's decompiled Java source is not copied into this project.

Before development or builds, `npm run worldgen:extract` reads the declarative noise and
density-function registries from your official Minecraft Java 26.2 JAR and creates the
ignored local file `src/generated/minecraft26WorldgenData.js`. Set
`MINECRAFT_26_2_SERVER_JAR` to the official server JAR path if it is not in the default
Minecraft or temporary-file locations.

The playable browser world uses Minecraft coordinates directly: sea level is Y=63 and
the build ceiling is Y=319. The engine currently omits Java's negative-Y deep layers.
