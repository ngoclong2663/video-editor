# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
bun dev        # start dev server at http://localhost:3000
bun build      # production build
bun lint       # ESLint
```

## Architecture

Single-page Next.js app. `app/page.tsx` renders `<VideoEditor />` directly — there is no routing.

### Component tree

```
app/components/video-editor/
├── index.tsx                          ← thin orchestrator: wires hooks + renders layout
├── types.ts                           ← Clip, Overlay, OverlayType, ExportResolution
├── utils.ts                           ← formatTime helper
├── hooks/
│   ├── use-clip-action.ts             ← clip state + upload/delete/split logic
│   ├── use-overlay-action.ts          ← overlay state + add/update/move/resize logic
│   ├── use-timeline-action.ts         ← playhead time, play state, zoom
│   └── use-ffmpeg.ts                  ← export pipeline, export state
├── components/
│   ├── editor-header.tsx              ← top bar with title + export button
│   ├── tools-sidebar.tsx              ← narrow icon toolbar (split, overlays)
│   ├── media-panel.tsx                ← 320px left sidebar (composes below)
│   ├── clips-list.tsx                 ← draggable clip list (react-movable)
│   ├── overlays-list.tsx              ← draggable overlay list (react-movable)
│   ├── overlay-settings.tsx           ← selected overlay property form
│   ├── playback-controls.tsx          ← play/pause, scrubber, time display
│   └── timeline.tsx                   ← full timeline section with tracks + playhead
└── preview/
    └── index.tsx                      ← <video> + <canvas> overlay renderer
```

### State ownership

**`index.tsx`** destructures all four hooks and owns only `previewViewport` state (shared between preview and the ffmpeg coordinate transform). It composes cross-cutting actions — e.g. `handleDeleteClip` calls `deleteClip` + `setTimelineTime(0)` + `resetExport()`.

**`useClipAction`** manages `clips[]` and the active `selectedClipId` (derived during render via `useMemo` to avoid setState-in-effect). `splitAtPlayhead(timelineTime)` and `addOverlay(type, totalDuration)` in the overlay hook both accept their external dependency as a function argument to avoid circular hook dependencies.

**`useOverlayAction`** manages `overlays[]` and `selectedOverlayId` (same derived-selection pattern).

**`useTimelineAction`** manages `timelineTime`, `isPlaying`, and `timelineZoom`. `handleTimelineSeek` lives in `index.tsx` because it needs `totalDuration` from `useClipAction`.

**`useFfmpeg`** takes `clips`, `overlays`, and `previewViewport` as parameters. Contains the full ffmpeg.wasm export pipeline.

**`VideoEditorPreview` (preview/index.tsx)** renders a `<video>` element plus a `<canvas>` overlay. The canvas draws text/shape overlays and 8-handle selection boxes via direct 2D context calls. Pointer events implement drag-to-move and resize for overlays.

### ffmpeg.wasm

ffmpeg assets are pre-bundled at `public/ffmpeg/` (core JS, WASM, worker, and a fallback font). `next.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on all routes — these headers are required for `SharedArrayBuffer` (used by the ffmpeg worker). Removing them will silently break export.

The export pipeline in `use-ffmpeg.ts`:
1. Normalises each clip individually with `libx264 ultrafast` (trim → fps=30 → reset PTS → resample audio).
2. Frees source files from WASM heap before the main encode to avoid OOM.
3. Concatenates clips with a `filter_complex`, bakes text/rect/line overlays via ffmpeg drawtext/drawbox/drawline filters, and renders circle overlays to PNG first (canvas → `ffmpeg.writeFile`) since `geq` is too slow in WASM.
4. Overlay coordinates are scaled from canvas-space to video-space via `vx/vy/vw/vh` helpers derived from a letterbox transform.

### shadcn/ui

Config is in `components.json` (style: `radix-nova`, aliases: `@/components/ui`). Add new components with:
```bash
bunx shadcn add <component>
```
