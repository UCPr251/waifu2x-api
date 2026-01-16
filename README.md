# Waifu2x API Service

A TypeScript/Node.js service that schedules and executes waifu2x image upscaling jobs with PostgreSQL-backed caching, filesystem storage, configurable concurrency via `p-queue`, and a simple test client.

Mainly used for custom [processImage](./test/processImage.js) in [venera](https://github.com/venera-app/venera).

## Features

- **Express 5 API** exposing `/upscale` and `/download` endpoints with rate limiting, auth hooks, and structured log output.
- **Task orchestration** powered by a PostgreSQL table (`waifu2x_tasks`), a file cache, and a dynamic `p-queue` scheduler honoring FIFO/LIFO strategies.
- **Cache deduplication** that reuses completed results and in-flight jobs using deterministic cache keys.
- **Runtime configuration** hot-reloaded from `config.json`, covering waifu2x parameters, scheduler tuning, logging, and filesystem paths.
- **Test utilities** for exercising the API (`test/processImage.js`, `test/test_database.js`) and resetting the database (`test/reset_database.js`).

## Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+ running and reachable via the configured `connectionString`
- waifu2x-ncnn-vulkan binary (or compatible) accessible at the path defined in `config.json`

## Getting Started

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Configure the service**
   - Copy `config.example.json` to `config.json`.
   - Adjust:
     - `api` host/port and optional `maxInputSizeMB`.
     - `postgres.connectionString` (and `ssl` if needed).
     - `waifu2x` executable path and default upscale parameters.
     - `scheduler` settings (`concurrency`, `queueStrategy`, `maxQueueSize`, `taskTimeoutMs`).
     - `cache.ttlSeconds`, filesystem paths.
3. **Prepare PostgreSQL**
   - Ensure the target database exists and the `connectionString` user has privileges.
   - Initialize/reset the schema with (auto-initialize on startup):
     ```bash
     node test/reset_database.js
     ```
4. **Build dist**
    ```bash
    pnpm build
    ```
5. **Run the service**
   With pm2 (recommended):
   ```bash
   pnpm start
   ```
   Or directly:
   ```bash
   node .
   ```
6. **Interact with the API**
   - POST binary data to `http://<host>:<port>/api/upscale` with required query params (`sourceKey`, `cid`, etc.).
   - Poll `.../download/<taskId>` until the result is ready (legacy `.../download?taskId=...` remains supported).
   - Use `test/processImage.js` as a reference client for venera.

## Logging

The custom logger (log4js + chalk) emits color-coded, bracketed tags to differentiate subsystems. Log level hot-reloads when `config.json` changes.

## Real-Time Log Page

- Visit `http://<host>:<port>/log` to watch structured logs live; append `?token=<config.api.logToken>` (and set the token in `config.json`) to gate access. The page remembers your token in `localStorage` for future reloads.
- Five consecutive invalid tokens from the same IP will push that IP into `config.api.blackIPs`, so share URLs carefully.

<details>
<summary>Real-Time Log Page</summary>
<p align="center">
  <img width="800" src="https://s2.loli.net/2026/01/16/SThXGx3qRw7EtIc.png" title="Real-Time Log Page">
</p>
</details>

## Visual Upscaling Studio

- Open `http://<host>:<port>/studio` to access the drag-and-drop interface. It supports file validation, parameter tweaking (scale/noise/model/format/tile/gpu/threads), TTA toggles, queue status visualization, and automatic polling with download + copy-link actions.
- Just for fun. It is quite cool.

<details>
<summary>Visual Upscaling Studio</summary>
<p align="center">
  <img width="800" src="https://s2.loli.net/2026/01/16/g2cUEQKxSkh8FNl.png" title="Visual Upscaling Studio">
</p>
</details>

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the API under PM2 using `pm2.json` |
| `pnpm logs` | Tail PM2 logs for `waifu2x-api` with raw output |
| `pnpm stop` | Stop the `waifu2x-api` process managed by PM2 |
| `pnpm restart` | Restart the PM2 process to pick up new builds |
| `pnpm build` | Compile TypeScript sources via `tsc` |
| `pnpm build:css -- resources/<dir>` | Build Tailwind assets for `resources/log` or `resources/studio` (`<dir>` = target folder) |
| `pnpm re` | Pull latest git changes, rebuild, and restart PM2 |
| `pnpm run` | Execute the API directly with `node .` |
| `pnpm dev` | Watch `src` changes via nodemon (`tsc && node .`) |

## Testing Utilities

- `test/processImage.js` demonstrates how to call the API in Venera.
- `test/test_database.js` confirms DB connectivity and prints query timing.
- `test/reset_database.js` safely rebuilds the schema.
- `test/test_waifu2x.js` test script for waifu2x upscaling functionality.
