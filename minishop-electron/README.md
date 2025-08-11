# MiniShop — Electron build

## Quick start (Windows 10/11)
1. Install Node.js (v18+).
2. In this folder, run:
   ```bash
   npm install
   npm run electron:dev
   ```
   That opens the app in an Electron window pointing at the Vite dev server.

## Build a portable .exe
```bash
npm run electron:build
```
Your Windows executable will be in `release/` (Portable build — a single .exe).

## Production app (without dev server)
The build step runs `vite build` and Electron loads `dist/index.html`:
- Dev: `npm run electron:dev`
- Prod build: `npm run electron:build`
