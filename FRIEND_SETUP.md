# Voxel Grove Friend Setup

## Easiest Option

If you received `Voxel-Grove-Setup-...exe`, just double-click it. You do not need Node.js.

When you get a newer setup file later, run it the same way. It replaces the old installed copy with the new version.

In the game, click `Servers` and enter the host address your friend gives you, for example:

```text
ws://192.168.1.25:25565
```

To host from the packaged app:

1. Open Voxel Grove.
2. Click `Servers`.
3. Click `Host LAN Server`.
4. Join:

```text
ws://127.0.0.1:25565
```

Give friends the LAN address shown in the server menu, for example:

```text
ws://192.168.1.25:25565
```

Keep the host game open while everyone plays.

## Source Folder Option

If you received the full source folder instead of the packaged `.exe`, install Node.js LTS from https://nodejs.org/ and then use:

- `Play Voxel Grove.bat` to play.
- `Host Multiplayer Voxel Grove.bat` to start a server and the game.
- `Start Dedicated Server.bat` to start only the server.

## Finding Your IPv4 Address

Open Command Prompt and run:

```bat
ipconfig
```

Look for `IPv4 Address` under your Wi-Fi or Ethernet adapter.

## If Friends Cannot Connect

Allow Voxel Grove through Windows Firewall when Windows asks. If they are outside your Wi-Fi, you will need router port forwarding for TCP port `25565`.
