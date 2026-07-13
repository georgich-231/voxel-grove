import process from "node:process";
import readline from "node:readline";
import { readServerOptions, startMultiplayerServer } from "./multiplayerServerCore.mjs";

const options = readServerOptions(process.argv.slice(2), process.env);

try {
  const server = await startMultiplayerServer({
    ...options,
    log: console.error,
  });
  const host = server.host === "0.0.0.0" ? "127.0.0.1" : server.host;
  console.log(`Voxel Grove multiplayer server listening at ws://${host}:${server.port}`);
  console.log(`Seed: ${server.seed}`);
  console.log("Server console ready. Type help for commands.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "vg> ",
  });
  rl.prompt();
  let stopping = false;  

  rl.on("line", async (line) => {
    const result = server.executeConsoleCommand(line);
    for (const message of result.messages ?? []) console.log(message);
    if (result.stop) {
      await stop();
      return;
    }
    rl.prompt();
  });

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    rl.close();
    await server.stop();
    process.exit(0);
  };

  rl.on("SIGINT", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  console.error("Multiplayer server failed:", error);
  process.exitCode = 1;
}
