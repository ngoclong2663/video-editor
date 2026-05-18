"use client";

import * as React from "react";
import type { Clip, Overlay, ExportResolution } from "../types";

type Viewport = { width: number; height: number };

export function useFfmpeg(
    clips: Clip[],
    overlays: Overlay[],
    previewViewport: Viewport,
) {
    const [exportResolution, setExportResolution] =
        React.useState<ExportResolution>("source");
    const [exportProgress, setExportProgress] = React.useState(0);
    const [exportUrl, setExportUrl] = React.useState<string | null>(null);
    const [exportError, setExportError] = React.useState<string | null>(null);
    const [isExporting, setIsExporting] = React.useState(false);

    const resetExport = React.useCallback(() => {
        setExportUrl(null);
        setExportError(null);
    }, []);

    const handleExport = React.useCallback(async () => {
        if (clips.length === 0) return;

        setIsExporting(true);
        setExportProgress(0);
        setExportError(null);
        setExportUrl(null);

        try {
            const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
                import("@ffmpeg/ffmpeg"),
                import("@ffmpeg/util"),
            ]);

            const base = `${location.origin}/ffmpeg`;

            const ffmpeg = new FFmpeg();
            ffmpeg.on("log", ({ message }) => console.log("[ffmpeg log]", message));
            ffmpeg.on("progress", ({ progress }) => {
                setExportProgress(Math.min(100, Math.round(progress * 100)));
            });

            const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
            const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");

            await ffmpeg.load({
                classWorkerURL: `${base}/ffmpeg-worker.js`,
                coreURL,
                wasmURL,
            });

            // Write each unique source file only once — clips that share the same
            // File object (e.g. from a split) must not be written twice.
            const fileToSrc = new Map<File, string>();
            for (const clip of clips) {
                if (!fileToSrc.has(clip.file)) {
                    const srcName = `src_${fileToSrc.size}.mp4`;
                    fileToSrc.set(clip.file, srcName);
                    await ffmpeg.writeFile(srcName, await fetchFile(clip.file));
                }
            }

            // Normalise each clip: trim, reset PTS, force 30fps, normalise audio.
            for (let i = 0; i < clips.length; i++) {
                const clip = clips[i];
                const src = fileToSrc.get(clip.file)!;
                const len = clip.end - clip.start;
                setExportProgress(0);
                await ffmpeg.exec([
                    "-ss", `${clip.start}`,
                    "-t",  `${len}`,
                    "-i",  src,
                    "-vf", "fps=30,setpts=PTS-STARTPTS",
                    "-af", "aresample=44100,aformat=channel_layouts=stereo",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "28",
                    "-c:a", "aac",
                    `input-${i}.mp4`,
                ]);
            }

            // Free large source files from WASM heap immediately to avoid OOM.
            for (const srcName of fileToSrc.values()) {
                try { await ffmpeg.deleteFile(srcName); } catch { /* ignore */ }
            }

            const hasTextOverlays = overlays.some((o) => o.type === "text");
            if (hasTextOverlays) {
                const fontData = await fetch(`${base}/font.ttf`).then((r) =>
                    r.arrayBuffer(),
                );
                await ffmpeg.writeFile("font.ttf", new Uint8Array(fontData));
            }

            // --- coordinate transform: canvas-space → video-space ---
            // Cap "source" resolution at 1280×720 for WASM single-threaded x264.
            const MAX_WASM_PX = 1280 * 720;
            let refW = clips[0].width;
            let refH = clips[0].height;
            if (refW * refH > MAX_WASM_PX) {
                const ratio = Math.sqrt(MAX_WASM_PX / (refW * refH));
                refW = Math.round(refW * ratio / 2) * 2;
                refH = Math.round(refH * ratio / 2) * 2;
            }
            const canvasW = previewViewport.width;
            const canvasH = previewViewport.height;
            const clipAspect = refW / refH;
            const canvasAspect = canvasW / canvasH;
            let renderedW: number, renderedH: number, offsetX: number, offsetY: number;
            if (clipAspect > canvasAspect) {
                renderedW = canvasW; renderedH = canvasW / clipAspect;
                offsetX = 0; offsetY = (canvasH - renderedH) / 2;
            } else {
                renderedH = canvasH; renderedW = canvasH * clipAspect;
                offsetX = (canvasW - renderedW) / 2; offsetY = 0;
            }
            const sx = refW / renderedW;
            const sy = refH / renderedH;
            const vx = (n: number) => Math.round((n - offsetX) * sx);
            const vy = (n: number) => Math.round((n - offsetY) * sy);
            const vw = (n: number) => Math.round(n * sx);
            const vh = (n: number) => Math.round(n * sy);

            // Render circles and lines to PNG on a browser canvas.
            // drawline doesn't exist in this ffmpeg.wasm build; geq (per-pixel math)
            // is painfully slow. PNG + overlay filter is orders of magnitude faster
            // and handles any shape the canvas 2D API can draw.
            const canvasOverlays = overlays.filter(
                (o) => o.type === "circle" || o.type === "line",
            );
            const canvasInputArgs: string[] = [];
            for (let i = 0; i < canvasOverlays.length; i++) {
                const o = canvasOverlays[i];
                const offscreen = document.createElement("canvas");
                offscreen.width = refW;
                offscreen.height = refH;
                const ctx = offscreen.getContext("2d")!;

                if (o.type === "circle") {
                    const cx = vx(o.x + o.width / 2);
                    const cy = vy(o.y + o.height / 2);
                    const rx = Math.max(1, vw(o.width / 2));
                    const ry = Math.max(1, vh(o.height / 2));
                    ctx.beginPath();
                    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                    if (o.fillEnabled) { ctx.fillStyle = o.color; ctx.fill(); }
                    if (o.strokeWidth > 0) {
                        ctx.strokeStyle = o.strokeColor;
                        ctx.lineWidth = Math.max(1, vh(o.strokeWidth));
                        ctx.stroke();
                    }
                } else {
                    // line
                    ctx.beginPath();
                    ctx.moveTo(vx(o.x), vy(o.y));
                    ctx.lineTo(vx(o.x + o.width), vy(o.y + o.height));
                    ctx.strokeStyle = o.strokeColor;
                    ctx.lineWidth = Math.max(1, vh(o.strokeWidth));
                    ctx.stroke();
                }

                const png = await new Promise<Uint8Array>((res) =>
                    offscreen.toBlob(
                        (blob) => blob!.arrayBuffer().then((b) => res(new Uint8Array(b))),
                        "image/png",
                    ),
                );
                await ffmpeg.writeFile(`canvas_${i}.png`, png);
                // No -loop 1: the PNG produces exactly one frame; eof_action=repeat
                // holds it for the full video. With -loop 1 the infinite PNG stream
                // causes the video to loop forever once the source ends.
                canvasInputArgs.push("-i", `canvas_${i}.png`);
            }
            const canvasStreamIndex = new Map(
                canvasOverlays.map((o, i) => [o.id, clips.length + i]),
            );

            const inputArgs: string[] = [];
            clips.forEach((_, index) => inputArgs.push("-i", `input-${index}.mp4`));

            const includeAudio = clips.every((c) => c.hasAudio);
            if (!includeAudio) {
                setExportError(
                    "Exported without audio. Some clips may not include audio tracks.",
                );
            }

            const scaleFilter = `scale=${refW}:${refH}:force_original_aspect_ratio=decrease,pad=${refW}:${refH}:-1:-1:color=black,setsar=1`;

            let filter: string;
            let videoLabel: string;
            if (clips.length === 1) {
                filter = `[0:v]${scaleFilter}[basev]`;
                if (includeAudio) filter += ";[0:a]acopy[basea]";
                videoLabel = "basev";
            } else {
                const scaledLabels = clips.map((_, i) => `sv${i}`);
                filter = clips.map((_, i) => `[${i}:v]${scaleFilter}[sv${i}]`).join(";");
                const concatInputs = scaledLabels
                    .map((lbl, i) => (includeAudio ? `[${lbl}][${i}:a]` : `[${lbl}]`))
                    .join("");
                filter += `;${concatInputs}concat=n=${clips.length}:v=1:a=${includeAudio ? 1 : 0}[basev]${includeAudio ? "[basea]" : ""}`;
                videoLabel = "basev";
            }

            overlays.forEach((overlay, index) => {
                const enable = `between(t,${overlay.startTime},${overlay.endTime})`;
                const nextLabel = `v${index}`;

                if (overlay.type === "text") {
                    const safeText = overlay.text.replace(/[:\\']/g, (m) => `\\${m}`);
                    filter += `;[${videoLabel}]drawtext=fontfile=font.ttf:text='${safeText}':x=${vx(overlay.x)}:y=${vy(overlay.y)}:fontsize=${vh(overlay.fontSize)}:fontcolor=${overlay.color}:enable='${enable}'[${nextLabel}]`;
                } else if (overlay.type === "rect") {
                    const hasFill = overlay.fillEnabled;
                    const hasStroke = overlay.strokeWidth > 0;
                    let cur = videoLabel;
                    if (hasFill) {
                        const lbl = hasStroke ? `${nextLabel}_f` : nextLabel;
                        filter += `;[${cur}]drawbox=x=${vx(overlay.x)}:y=${vy(overlay.y)}:w=${vw(overlay.width)}:h=${vh(overlay.height)}:color=${overlay.color}:t=fill:enable='${enable}'[${lbl}]`;
                        cur = lbl;
                    }
                    if (hasStroke) {
                        filter += `;[${cur}]drawbox=x=${vx(overlay.x)}:y=${vy(overlay.y)}:w=${vw(overlay.width)}:h=${vh(overlay.height)}:color=${overlay.strokeColor}:t=${Math.max(1, vh(overlay.strokeWidth))}:enable='${enable}'[${nextLabel}]`;
                    } else if (!hasFill) {
                        filter += `;[${cur}]null[${nextLabel}]`;
                    }
                } else if (overlay.type === "circle" || overlay.type === "line") {
                    const si = canvasStreamIndex.get(overlay.id)!;
                    filter += `;[${videoLabel}][${si}:v]overlay=enable='${enable}'[${nextLabel}]`;
                }

                videoLabel = nextLabel;
            });

            if (exportResolution !== "source") {
                const scale = exportResolution === "720p" ? "scale=-2:720" : "scale=-2:1080";
                filter += `;[${videoLabel}]${scale}[scaled]`;
                videoLabel = "scaled";
            }

            const outputArgs = [
                "-filter_complex", filter,
                "-map", `[${videoLabel}]`,
                "-c:v", "libx264",
                // ultrafast is critical for WASM — single-threaded libx264 at
                // medium preset encodes ~3 fps on 1080p; ultrafast reaches ~30-60 fps.
                "-preset", "ultrafast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
            ];
            if (includeAudio) {
                outputArgs.push("-map", "[basea]", "-c:a", "aac");
            } else {
                outputArgs.push("-an");
            }
            outputArgs.push("output.mp4");

            await ffmpeg.exec([...inputArgs, ...canvasInputArgs, ...outputArgs]);

            const data = await ffmpeg.readFile("output.mp4");
            const outputData =
                typeof data === "string"
                    ? new TextEncoder().encode(data)
                    : new Uint8Array(data);
            const output = new Blob([outputData], { type: "video/mp4" });
            const downloadUrl = URL.createObjectURL(output);
            setExportUrl(downloadUrl);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = "export.mp4";
            a.click();
        } catch (error) {
            console.error("Export failed", error);
            setExportError(
                error instanceof Error ? error.message : "Export failed",
            );
        } finally {
            setIsExporting(false);
        }
    }, [clips, overlays, previewViewport, exportResolution]);

    return {
        exportResolution,
        setExportResolution,
        exportProgress,
        exportUrl,
        exportError,
        isExporting,
        resetExport,
        handleExport,
    };
}
