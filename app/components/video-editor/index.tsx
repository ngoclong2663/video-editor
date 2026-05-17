"use client";

import * as React from "react";
import { List, arrayMove } from "react-movable";

import {
    ChevronLeft,
    ChevronRight,
    Clapperboard,
    Download,
    Film,
    Circle,
    Layers,
    Menu,
    Minus,
    Pause,
    Play,
    Plus,
    Scissors,
    Square,
    Shapes,
    Trash2,
    Type,
    Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VideoEditorPreview from "./preview";
import type { Clip, Overlay, OverlayType } from "./types";

type ExportResolution = "source" | "720p" | "1080p";

const createId = () => crypto.randomUUID();

const probeFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    const result = await new Promise<{
        duration: number;
        hasAudio: boolean;
        width: number;
        height: number;
    }>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = url;
        video.onloadeddata = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = video as any;
            // audioTracks is reliably populated by loadeddata (not loadedmetadata)
            const hasAudio =
                v.mozHasAudio === true ||
                (v.audioTracks != null && v.audioTracks.length > 0) ||
                v.webkitAudioDecodedByteCount > 0;
            resolve({
                duration: video.duration || 0,
                hasAudio,
                width: video.videoWidth,
                height: video.videoHeight,
            });
        };
        video.onerror = () =>
            reject(new Error("Failed to read video metadata"));
    });
    URL.revokeObjectURL(url);
    return result;
};

const createClipFromFile = async (file: File): Promise<Clip> => {
    const { duration, hasAudio, width, height } = await probeFile(file);

    return {
        id: createId(),
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        start: 0,
        end: duration,
        duration,
        hasAudio,
        width,
        height,
    };
};

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

const formatTime = (value: number) => {
    if (!Number.isFinite(value)) return "00:00";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
};

const VideoEditor = () => {
    const [clips, setClips] = React.useState<Clip[]>([]);
    const [overlays, setOverlays] = React.useState<Overlay[]>([]);
    const [selectedClipId, setSelectedClipId] = React.useState<string | null>(
        null,
    );
    const [selectedOverlayId, setSelectedOverlayId] = React.useState<
        string | null
    >(null);
    const [timelineTime, setTimelineTime] = React.useState(0);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [exportResolution, setExportResolution] =
        React.useState<ExportResolution>("source");
    const [exportProgress, setExportProgress] = React.useState(0);
    const [exportUrl, setExportUrl] = React.useState<string | null>(null);
    const [exportError, setExportError] = React.useState<string | null>(null);
    const [isExporting, setIsExporting] = React.useState(false);
    const [previewViewport, setPreviewViewport] = React.useState({
        width: 1280,
        height: 720,
    });
    const handleViewportChange = React.useCallback((w: number, h: number) => {
        setPreviewViewport((prev) =>
            prev.width === w && prev.height === h
                ? prev
                : { width: w, height: h },
        );
    }, []);

    const totalDuration = React.useMemo(
        () => clips.reduce((total, clip) => total + (clip.end - clip.start), 0),
        [clips],
    );

    React.useEffect(() => {
        if (!selectedClipId && clips.length > 0) {
            setSelectedClipId(clips[0].id);
        }
    }, [clips, selectedClipId]);

    React.useEffect(() => {
        if (!selectedOverlayId && overlays.length > 0) {
            setSelectedOverlayId(overlays[0].id);
        }
    }, [overlays, selectedOverlayId]);

    const selectedOverlay = React.useMemo(
        () =>
            overlays.find((overlay) => overlay.id === selectedOverlayId) ??
            null,
        [overlays, selectedOverlayId],
    );

    const findClipAtTimelineTime = React.useCallback(
        (time: number) => {
            let cursor = 0;

            for (let index = 0; index < clips.length; index += 1) {
                const clip = clips[index];
                const length = clip.end - clip.start;

                if (time <= cursor + length || index === clips.length - 1) {
                    return {
                        clip,
                        index,
                        clipStart: cursor,
                        localOffset: Math.max(0, time - cursor),
                    };
                }

                cursor += length;
            }

            return null;
        },
        [clips],
    );

    const handleSplitAtTime = React.useCallback(
        (time: number) => {
            const target = findClipAtTimelineTime(time);
            if (!target) return;

            const splitPoint = clamp(
                target.clip.start + target.localOffset,
                target.clip.start + 0.1,
                target.clip.end - 0.1,
            );

            const left: Clip = {
                ...target.clip,
                id: createId(),
                end: splitPoint,
            };
            const right: Clip = {
                ...target.clip,
                id: createId(),
                start: splitPoint,
            };

            setClips((prev) => {
                const next = [...prev];
                next.splice(target.index, 1, left, right);
                return next;
            });
            setSelectedClipId(left.id);
        },
        [findClipAtTimelineTime],
    );

    const handleSplitAtPlayhead = React.useCallback(() => {
        if (totalDuration === 0) return;
        handleSplitAtTime(timelineTime);
    }, [handleSplitAtTime, timelineTime, totalDuration]);

    const handleDeleteClip = React.useCallback((id: string) => {
        setClips((prev) => prev.filter((c) => c.id !== id));
        setSelectedClipId((prev) => (prev === id ? null : prev));
        setTimelineTime(0);
        setExportUrl(null);
        setExportError(null);
    }, []);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            if (
                document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement
            )
                return;
            setSelectedClipId((id) => {
                if (id) handleDeleteClip(id);
                return id;
            });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleDeleteClip]);

    const handleUploadBase = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;

        const prepared = await Promise.all(files.map(createClipFromFile));
        setClips(prepared);
        setTimelineTime(0);
        setExportUrl(null);
        setExportError(null);
        event.target.value = "";
    };

    const handleAddClips = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;

        const prepared = await Promise.all(files.map(createClipFromFile));
        setClips((prev) => [...prev, ...prepared]);
        setExportUrl(null);
        setExportError(null);
        event.target.value = "";
    };

    const handleAddOverlay = (type: OverlayType) => {
        const base: Overlay = {
            id: createId(),
            type,
            text: type === "text" ? "New text" : "",
            x: 80,
            y: 80,
            width: type === "circle" ? 120 : 180,
            height: type === "circle" ? 120 : 90,
            color: "#f97316",
            // Shapes start stroke-only (transparent fill); text always has fill
            fillEnabled: type === "text",
            strokeColor: "#f97316",
            strokeWidth: type === "text" ? 0 : 3,
            fontSize: 28,
            startTime: 0,
            endTime: Math.max(1, totalDuration || 5),
        };

        setOverlays((prev) => [...prev, base]);
        setSelectedOverlayId(base.id);
    };

    const updateOverlay = (patch: Partial<Overlay>) => {
        if (!selectedOverlay) return;
        setOverlays((prev) =>
            prev.map((overlay) =>
                overlay.id === selectedOverlay.id
                    ? { ...overlay, ...patch }
                    : overlay,
            ),
        );
    };

    const handleOverlayPositionChange = (id: string, x: number, y: number) => {
        setOverlays((prev) =>
            prev.map((overlay) =>
                overlay.id === id ? { ...overlay, x, y } : overlay,
            ),
        );
    };

    const handleOverlayResize = React.useCallback(
        (id: string, x: number, y: number, width: number, height: number) => {
            setOverlays((prev) =>
                prev.map((overlay) =>
                    overlay.id === id
                        ? { ...overlay, x, y, width, height }
                        : overlay,
                ),
            );
        },
        [],
    );

    const [timelineZoom, setTimelineZoom] = React.useState(1);

    const handleTimelineSeek = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    ) => {
        if (totalDuration === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        setTimelineTime(ratio * totalDuration);
    };

    const handleExport = async () => {
        if (clips.length === 0) return;

        setIsExporting(true);
        setExportProgress(0);
        setExportError(null);
        setExportUrl(null);

        try {
            console.log("[export] step 1: importing ffmpeg modules");
            const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
                import("@ffmpeg/ffmpeg"),
                import("@ffmpeg/util"),
            ]);
            console.log("[export] step 2: modules imported OK");

            const base = `${location.origin}/ffmpeg`;
            console.log("[export] step 3: base URL =", base);

            const ffmpeg = new FFmpeg();
            ffmpeg.on("log", ({ message }) =>
                console.log("[ffmpeg log]", message),
            );
            ffmpeg.on("progress", ({ progress }) => {
                setExportProgress(Math.min(100, Math.round(progress * 100)));
            });

            console.log("[export] step 4: creating blob URLs");
            const coreURL = await toBlobURL(
                `${base}/ffmpeg-core.js`,
                "text/javascript",
            );
            console.log("[export] step 5: coreURL =", coreURL);
            const wasmURL = await toBlobURL(
                `${base}/ffmpeg-core.wasm`,
                "application/wasm",
            );
            console.log("[export] step 6: wasmURL =", wasmURL);

            console.log("[export] step 7: loading ffmpeg, classWorkerURL =", `${base}/ffmpeg-worker.js`);
            await ffmpeg.load({
                classWorkerURL: `${base}/ffmpeg-worker.js`,
                coreURL,
                wasmURL,
            });
            console.log("[export] step 8: ffmpeg loaded OK");

            // Write each unique source file only ONCE — clips that share the
            // same File object (e.g. from a split) must not write it twice.
            const fileToSrc = new Map<File, string>();
            for (const clip of clips) {
                if (!fileToSrc.has(clip.file)) {
                    const srcName = `src_${fileToSrc.size}.mp4`;
                    fileToSrc.set(clip.file, srcName);
                    console.log(
                        `[export] writing source: ${clip.file.name} (${(clip.file.size / 1024 / 1024).toFixed(1)} MB)`,
                    );
                    await ffmpeg.writeFile(
                        srcName,
                        await fetchFile(clip.file),
                    );
                    console.log(`[export] source write OK`);
                }
            }

            // Normalise each clip: decode only the needed seconds, reset PTS,
            // force 30 fps, normalise audio. Ultrafast re-encode keeps each
            // pass to < 5 s even for long sources.
            setExportError(null); // clear any stale warning

            for (let i = 0; i < clips.length; i++) {
                const clip = clips[i];
                const src = fileToSrc.get(clip.file)!;
                const len = clip.end - clip.start;
                console.log(`[export] normalising clip ${i}: ${clip.start.toFixed(2)}s – ${clip.end.toFixed(2)}s`);
                // Temporarily reset progress display to show step info
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
                console.log(`[export] clip ${i} normalise OK`);
            }

            // Free large source files from WASM heap immediately — without this
            // a 680 MB source stays resident while the main encode runs, exhausting
            // the WASM memory budget and causing silent hangs.
            for (const srcName of fileToSrc.values()) {
                try { await ffmpeg.deleteFile(srcName); } catch { /* ignore */ }
            }
            console.log("[export] source files deleted, starting main encode");

            const hasTextOverlays = overlays.some((o) => o.type === "text");
            if (hasTextOverlays) {
                const fontData = await fetch(`${base}/font.ttf`).then((r) =>
                    r.arrayBuffer(),
                );
                await ffmpeg.writeFile("font.ttf", new Uint8Array(fontData));
            }

            // --- coordinate transform setup ---
            // Cap "source" resolution at 1280×720 for WASM single-threaded x264.
            // Encoding 1920×1080 in WASM takes ~3 fps; 720p is 2.25× fewer pixels.
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

            // --- render circle overlays to PNG on a browser canvas ---
            // Avoids geq (per-pixel math: painfully slow + outputs RGB that
            // libx264 can't encode). PNG + overlay filter is orders of magnitude faster.
            const circleOverlays = overlays.filter((o) => o.type === "circle");
            const circleInputArgs: string[] = [];
            for (let i = 0; i < circleOverlays.length; i++) {
                const o = circleOverlays[i];
                const offscreen = document.createElement("canvas");
                offscreen.width = refW;
                offscreen.height = refH;
                const ctx = offscreen.getContext("2d")!;
                const cx = vx(o.x + o.width / 2);
                const cy = vy(o.y + o.height / 2);
                const rx = Math.max(1, vw(o.width / 2));
                const ry = Math.max(1, vh(o.height / 2));
                ctx.beginPath();
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                if (o.fillEnabled) {
                    ctx.fillStyle = o.color;
                    ctx.fill();
                }
                if (o.strokeWidth > 0) {
                    ctx.strokeStyle = o.strokeColor;
                    ctx.lineWidth = Math.max(1, vh(o.strokeWidth));
                    ctx.stroke();
                }
                const png = await new Promise<Uint8Array>((res) =>
                    offscreen.toBlob(
                        (blob) =>
                            blob!
                                .arrayBuffer()
                                .then((b) => res(new Uint8Array(b))),
                        "image/png",
                    ),
                );
                await ffmpeg.writeFile(`circle_${i}.png`, png);
                // No -loop 1 here. Without it the PNG produces exactly one frame;
                // the overlay filter's default eof_action=repeat holds that frame
                // for the entire video. With -loop 1 the PNG stream is infinite,
                // and eof_action=repeat then loops the last *video* frame forever
                // once the video ends — causing the infinite export.
                circleInputArgs.push("-i", `circle_${i}.png`);
            }
            // map overlay.id → ffmpeg input stream index
            const circleStreamIndex = new Map(
                circleOverlays.map((o, i) => [o.id, clips.length + i]),
            );

            // Files are already trimmed — no -ss/-t needed here
            const inputArgs: string[] = [];
            clips.forEach((_, index) => {
                inputArgs.push("-i", `input-${index}.mp4`);
            });

            const includeAudio = clips.every((c) => c.hasAudio);
            if (!includeAudio) {
                setExportError(
                    "Exported without audio. Some clips may not include audio tracks.",
                );
            }

            // Inputs are already fps=30 + aresample'd by the pre-trim step,
            // so the main export just needs scale + pad + setsar.
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
                    .map((lbl, i) => includeAudio ? `[${lbl}][${i}:a]` : `[${lbl}]`)
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
                } else if (overlay.type === "line") {
                    filter += `;[${videoLabel}]drawline=x=${vx(overlay.x)}:y=${vy(overlay.y)}:x2=${vx(overlay.x + overlay.width)}:y2=${vy(overlay.y + overlay.height)}:color=${overlay.strokeColor}:thickness=${Math.max(1, vh(overlay.strokeWidth))}:enable='${enable}'[${nextLabel}]`;
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
                        // no-op overlay — just pass through
                        filter += `;[${cur}]null[${nextLabel}]`;
                    }
                } else if (overlay.type === "circle") {
                    const si = circleStreamIndex.get(overlay.id)!;
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
                // ultrafast is the most important flag for WASM — single-threaded
                // libx264 at medium preset encodes ~3 fps on a 1080p stream;
                // ultrafast gets to ~30-60 fps, a 10-20× speedup.
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

            await ffmpeg.exec([...inputArgs, ...circleInputArgs, ...outputArgs]);

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
    };

    const timelineTicks = Array.from({ length: 9 }, (_, index) => index);

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1a2230_0,#0b0d10_45%,#07080a_100%)] text-slate-100">
            <header className="flex items-center justify-between border-b border-white/5 bg-[#0f1216] px-6 py-4">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-200"
                    >
                        <Menu className="size-4" />
                    </Button>
                    <div>
                        <p className="text-xs uppercase tracking-[0.26em] text-slate-500">
                            Keyframes Studio
                        </p>
                        <h1 className="font-heading text-lg font-semibold text-white">
                            My Workspace // Demo Reel
                        </h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" className="gap-2">
                        <Clapperboard className="size-4" />
                        Preview mode
                    </Button>
                    <Button
                        className="gap-2"
                        onClick={handleExport}
                        disabled={isExporting || clips.length === 0}
                    >
                        <Download className="size-4" />
                        {isExporting
                            ? `Exporting ${exportProgress}%`
                            : "Export"}
                    </Button>
                </div>
            </header>

            <div className="flex min-h-[calc(100vh-72px)]">
                <aside className="flex w-16 flex-col items-center gap-4 border-r border-white/5 bg-[#0f1216] py-6 text-slate-400">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-300 hover:text-white"
                        title="Media"
                    >
                        <Film className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-300 hover:text-white"
                        title="Split at playhead"
                        onClick={handleSplitAtPlayhead}
                    >
                        <Scissors className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-300 hover:text-white"
                        title="Add text"
                        onClick={() => handleAddOverlay("text")}
                    >
                        <Type className="size-4" />
                    </Button>
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
                        <Shapes className="size-4 text-slate-400" />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-300 hover:text-white"
                            title="Rectangle"
                            onClick={() => handleAddOverlay("rect")}
                        >
                            <Square className="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-300 hover:text-white"
                            title="Circle"
                            onClick={() => handleAddOverlay("circle")}
                        >
                            <Circle className="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-300 hover:text-white"
                            title="Line"
                            onClick={() => handleAddOverlay("line")}
                        >
                            <Minus className="size-3.5" />
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-300 hover:text-white"
                        title="Layers"
                    >
                        <Layers className="size-4" />
                    </Button>
                </aside>

                <aside className="flex w-[320px] flex-col gap-4 border-r border-white/5 bg-[#11151b] p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs uppercase tracking-[0.26em] text-slate-500">
                                Media Library
                            </p>
                            <p className="font-heading text-sm font-semibold text-slate-100">
                                Project Media
                            </p>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon">
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon">
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-dashed border-white/10 bg-[#0c0f14] p-4 text-center">
                        <Upload className="mx-auto size-5 text-emerald-300" />
                        <p className="mt-2 text-sm font-medium text-white">
                            Upload media files
                        </p>
                        <p className="text-xs text-slate-500">
                            Click to browse or drop files here
                        </p>
                        <div className="mt-3 grid gap-2">
                            <Input
                                type="file"
                                accept="video/*"
                                onChange={handleUploadBase}
                                className="text-xs text-slate-200 file:text-slate-200"
                            />
                            <Input
                                type="file"
                                accept="video/*"
                                onChange={handleAddClips}
                                multiple
                                className="text-xs text-slate-200 file:text-slate-200"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="font-heading text-sm font-semibold text-white">
                                Clips
                            </p>
                            <span className="text-xs text-slate-500">
                                {clips.length} items
                            </span>
                        </div>
                        <div className="space-y-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
                            <List
                                values={clips}
                                onChange={({ oldIndex, newIndex }) =>
                                    setClips((prev) =>
                                        arrayMove(prev, oldIndex, newIndex),
                                    )
                                }
                                renderList={({ children, props }) => (
                                    <div {...props} className="space-y-2">
                                        {children}
                                    </div>
                                )}
                                renderItem={({ value, props: { key, ...itemProps }, isDragged }) => (
                                    <div
                                        key={key}
                                        {...itemProps}
                                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                                            isDragged
                                                ? "border-emerald-400/60 bg-emerald-400/10"
                                                : value.id === selectedClipId
                                                  ? "border-emerald-400/40 bg-emerald-400/5"
                                                  : "border-white/10 bg-[#121821]"
                                        }`}
                                        onClick={() =>
                                            setSelectedClipId(value.id)
                                        }
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium text-white">
                                                {value.name}
                                            </p>
                                            <p className="text-[0.7rem] text-slate-500">
                                                {Math.max(
                                                    0,
                                                    value.end - value.start,
                                                ).toFixed(2)}
                                                s
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteClip(value.id);
                                            }}
                                            title="Delete clip"
                                        >
                                            <Trash2 className="size-3" />
                                        </button>
                                    </div>
                                )}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="font-heading text-sm font-semibold text-white">
                                Overlays
                            </p>
                            <span className="text-xs text-slate-500">
                                {overlays.length} items
                            </span>
                        </div>
                        <div className="space-y-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
                            <List
                                values={overlays}
                                onChange={({ oldIndex, newIndex }) =>
                                    setOverlays((prev) =>
                                        arrayMove(prev, oldIndex, newIndex),
                                    )
                                }
                                renderList={({ children, props }) => (
                                    <div {...props} className="space-y-2">
                                        {children}
                                    </div>
                                )}
                                renderItem={({ value, props: { key, ...itemProps }, isDragged }) => (
                                    <div
                                        key={key}
                                        {...itemProps}
                                        className={`rounded-lg border px-3 py-2 text-xs transition ${
                                            isDragged
                                                ? "border-pink-300/60 bg-pink-300/10"
                                                : value.id === selectedOverlayId
                                                  ? "border-pink-300/40 bg-pink-300/5"
                                                  : "border-white/10 bg-[#121821]"
                                        }`}
                                        onClick={() =>
                                            setSelectedOverlayId(value.id)
                                        }
                                    >
                                        <p className="font-medium capitalize text-white">
                                            {value.type}
                                        </p>
                                        <p className="text-[0.7rem] text-slate-500">
                                            {value.startTime.toFixed(1)}s -{" "}
                                            {value.endTime.toFixed(1)}s
                                        </p>
                                    </div>
                                )}
                            />
                        </div>
                    </div>

                    {selectedOverlay && (
                        <div className="space-y-2 rounded-2xl border border-white/5 bg-[#0c0f14] p-3">
                            <p className="text-xs uppercase tracking-[0.26em] text-slate-500">
                                Overlay settings
                            </p>
                            {selectedOverlay.type === "text" && (
                                <div className="grid gap-2">
                                    <label className="text-xs text-slate-500">
                                        Text
                                    </label>
                                    <Input
                                        value={selectedOverlay.text}
                                        onChange={(event) =>
                                            updateOverlay({
                                                text: event.target.value,
                                            })
                                        }
                                        className="bg-[#0b0d10]"
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">
                                        Start
                                    </label>
                                    <Input
                                        value={String(
                                            selectedOverlay.startTime,
                                        )}
                                        onChange={(event) =>
                                            updateOverlay({
                                                startTime:
                                                    Number.parseFloat(
                                                        event.target.value,
                                                    ) || 0,
                                            })
                                        }
                                        className="bg-[#0b0d10]"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">
                                        End
                                    </label>
                                    <Input
                                        value={String(selectedOverlay.endTime)}
                                        onChange={(event) =>
                                            updateOverlay({
                                                endTime:
                                                    Number.parseFloat(
                                                        event.target.value,
                                                    ) || 0,
                                            })
                                        }
                                        className="bg-[#0b0d10]"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-slate-500">
                                            Fill
                                        </label>
                                        <input
                                            type="checkbox"
                                            checked={
                                                selectedOverlay.fillEnabled
                                            }
                                            onChange={(e) =>
                                                updateOverlay({
                                                    fillEnabled:
                                                        e.target.checked,
                                                })
                                            }
                                            className="accent-emerald-400"
                                        />
                                    </div>
                                    <Input
                                        type="color"
                                        value={selectedOverlay.color}
                                        disabled={!selectedOverlay.fillEnabled}
                                        onChange={(event) =>
                                            updateOverlay({
                                                color: event.target.value,
                                            })
                                        }
                                        className={
                                            selectedOverlay.fillEnabled
                                                ? ""
                                                : "opacity-40"
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">
                                        Stroke color
                                    </label>
                                    <Input
                                        type="color"
                                        value={selectedOverlay.strokeColor}
                                        onChange={(event) =>
                                            updateOverlay({
                                                strokeColor: event.target.value,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500">
                                    Stroke width
                                </label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={20}
                                    value={selectedOverlay.strokeWidth}
                                    onChange={(event) =>
                                        updateOverlay({
                                            strokeWidth:
                                                Math.max(
                                                    0,
                                                    Number(event.target.value),
                                                ) || 0,
                                        })
                                    }
                                    className="bg-[#0b0d10]"
                                /></div>
                        </div>
                    )}
                </aside>

                <main className="flex flex-1 flex-col">
                    <div className="flex flex-1 flex-col gap-4 p-5">
                        <div className="rounded-3xl border border-white/5 bg-[#0f131a] p-4">
                            <VideoEditorPreview
                                clips={clips}
                                overlays={overlays}
                                currentTime={timelineTime}
                                isPlaying={isPlaying}
                                onTimeChange={setTimelineTime}
                                onPlaybackEnd={() => setIsPlaying(false)}
                                onOverlaySelect={setSelectedOverlayId}
                                selectedOverlayId={selectedOverlayId}
                                onOverlayPositionChange={handleOverlayPositionChange}
                                onOverlayResize={handleOverlayResize}
                                onPlayStateChange={setIsPlaying}
                                onViewportChange={handleViewportChange}
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#11151b] px-5 py-3">
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={() =>
                                        setIsPlaying((prev) => !prev)
                                    }
                                    disabled={clips.length === 0}
                                >
                                    {isPlaying ? (
                                        <Pause className="size-4" />
                                    ) : (
                                        <Play className="size-4" />
                                    )}
                                </Button>
                                <p className="text-xs text-slate-400">
                                    {formatTime(timelineTime)} /{" "}
                                    {formatTime(totalDuration)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setTimelineTime(0);
                                        setIsPlaying(false);
                                    }}
                                >
                                    Reset
                                </Button>
                                <Input
                                    type="range"
                                    min={0}
                                    max={totalDuration || 0}
                                    step={0.01}
                                    value={timelineTime}
                                    onChange={(event) =>
                                        setTimelineTime(
                                            Number.parseFloat(
                                                event.target.value,
                                            ),
                                        )
                                    }
                                    className="w-48"
                                    disabled={totalDuration === 0}
                                />
                            </div>
                        </div>
                    </div>

                    <section className="border-t border-white/5 bg-[#0f1216] p-4">
                        <div className="flex items-center justify-between">
                            <p className="font-heading text-sm font-semibold text-white">
                                Timeline
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="gap-2"
                                    onClick={handleSplitAtPlayhead}
                                    disabled={clips.length === 0}
                                >
                                    <Scissors className="size-4" />
                                    Split at playhead
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-2 text-slate-400"
                                >
                                    <Plus className="size-4" />
                                    Add track
                                </Button>
                                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0c0f14] px-2 py-1">
                                    {(
                                        [
                                            "source",
                                            "720p",
                                            "1080p",
                                        ] as ExportResolution[]
                                    ).map((option) => (
                                        <Button
                                            key={option}
                                            size="sm"
                                            variant={
                                                exportResolution === option
                                                    ? "default"
                                                    : "ghost"
                                            }
                                            onClick={() =>
                                                setExportResolution(option)
                                            }
                                        >
                                            {option}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Timeline tracks */}
                        <div className="mt-3">
                            {/* Zoom controls */}
                            <div className="mb-2 flex items-center justify-end gap-1">
                                <span className="mr-1 text-[0.65rem] text-slate-500">
                                    {Math.round(timelineZoom * 100)}%
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() =>
                                        setTimelineZoom((z) =>
                                            Math.max(1, +(z - 0.5).toFixed(1)),
                                        )
                                    }
                                    disabled={timelineZoom <= 1}
                                >
                                    <Minus className="size-3" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() =>
                                        setTimelineZoom((z) =>
                                            Math.min(8, +(z + 0.5).toFixed(1)),
                                        )
                                    }
                                >
                                    <Plus className="size-3" />
                                </Button>
                            </div>

                            <div className="flex items-start gap-3">
                                {/* Fixed label column */}
                                <div className="w-24 shrink-0 space-y-3 text-xs text-slate-400">
                                    <div className="flex h-5 items-center text-slate-500">
                                        Time
                                    </div>
                                    <div className="flex h-10 items-center">
                                        Video
                                    </div>
                                    <div className="flex h-8 items-center">
                                        Overlays
                                    </div>
                                </div>

                                {/* Scrollable track area */}
                                <div className="relative min-w-0 flex-1 overflow-x-auto">
                                    <div
                                        style={{
                                            minWidth: `${timelineZoom * 100}%`,
                                        }}
                                        className="relative"
                                    >
                                        {/* Time ticks */}
                                        <div className="mb-3 flex h-5 items-center gap-2 text-[0.65rem] text-slate-500">
                                            {timelineTicks.map((tick) => (
                                                <div
                                                    key={tick}
                                                    className="flex-1"
                                                >
                                                    <div className="h-2 w-px bg-white/10" />
                                                    {formatTime(
                                                        (totalDuration / 8) *
                                                            tick,
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Video track */}
                                        <div className="mb-3">
                                            <List
                                                values={clips}
                                                onChange={({
                                                    oldIndex,
                                                    newIndex,
                                                }) =>
                                                    setClips((prev) =>
                                                        arrayMove(
                                                            prev,
                                                            oldIndex,
                                                            newIndex,
                                                        ),
                                                    )
                                                }
                                                renderList={({
                                                    children,
                                                    props,
                                                }) => (
                                                    <div
                                                        {...props}
                                                        className="flex h-10 overflow-hidden rounded-xl border border-white/5 bg-[#0c0f14]"
                                                        onClick={
                                                            handleTimelineSeek
                                                        }
                                                    >
                                                        {children}
                                                    </div>
                                                )}
                                                renderItem={({
                                                    value,
                                                    props: {
                                                        key,
                                                        ...itemProps
                                                    },
                                                    isDragged,
                                                }) => {
                                                    const clipLength =
                                                        value.end - value.start;
                                                    const w = totalDuration
                                                        ? `${(clipLength / totalDuration) * 100}%`
                                                        : "100%";
                                                    const isSelected =
                                                        value.id ===
                                                        selectedClipId;
                                                    return (
                                                        <div
                                                            key={key}
                                                            {...itemProps}
                                                            style={{
                                                                ...itemProps.style,
                                                                width: w,
                                                            }}
                                                            className={`group relative flex shrink-0 items-center justify-center gap-1 overflow-hidden border-r border-white/5 px-2 text-[0.65rem] font-medium ${
                                                                isDragged
                                                                    ? "cursor-grabbing bg-emerald-400/30 text-emerald-100"
                                                                    : isSelected
                                                                      ? "cursor-grab bg-emerald-400/20 text-emerald-100"
                                                                      : "cursor-grab bg-emerald-400/10 text-emerald-200"
                                                            }`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedClipId(
                                                                    value.id,
                                                                );
                                                            }}
                                                        >
                                                            <span className="truncate">
                                                                {value.name}
                                                            </span>
                                                            {isSelected && (
                                                                <button
                                                                    type="button"
                                                                    className="shrink-0 rounded p-0.5 text-emerald-200 hover:bg-rose-500/30 hover:text-rose-300"
                                                                    onClick={(
                                                                        e,
                                                                    ) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteClip(
                                                                            value.id,
                                                                        );
                                                                    }}
                                                                    title="Delete clip"
                                                                >
                                                                    <Trash2 className="size-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                }}
                                            />
                                        </div>

                                        {/* Overlays track */}
                                        <div
                                            className="relative h-8 cursor-pointer rounded-xl border border-white/5 bg-[#0c0f14]"
                                            onClick={handleTimelineSeek}
                                        >
                                            {overlays.map((overlay) => {
                                                // Fall back to max overlay end time when no clips loaded
                                                const dur =
                                                    totalDuration ||
                                                    Math.max(
                                                        ...overlays.map(
                                                            (o) => o.endTime,
                                                        ),
                                                        1,
                                                    );
                                                const w =
                                                    ((overlay.endTime -
                                                        overlay.startTime) /
                                                        dur) *
                                                    100;
                                                const l =
                                                    (overlay.startTime / dur) *
                                                    100;
                                                return (
                                                    <button
                                                        key={overlay.id}
                                                        type="button"
                                                        className={`absolute top-1 h-6 rounded-lg px-2 text-[0.6rem] font-semibold ${
                                                            overlay.id ===
                                                            selectedOverlayId
                                                                ? "bg-pink-400 text-slate-950"
                                                                : "bg-pink-500/40 text-pink-100"
                                                        }`}
                                                        style={{
                                                            left: `${l}%`,
                                                            width: `${w}%`,
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedOverlayId(
                                                                overlay.id,
                                                            );
                                                        }}
                                                    >
                                                        {overlay.type}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Playhead — spans all rows */}
                                        <div
                                            className="pointer-events-none absolute inset-y-0 top-0 w-0.5 bg-emerald-400"
                                            style={{
                                                left: `${totalDuration ? (timelineTime / totalDuration) * 100 : 0}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        {exportUrl && !exportError && (
                            <a
                                href={exportUrl}
                                download="export.mp4"
                                className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                            >
                                <Download className="size-3" />
                                Download export.mp4
                            </a>
                        )}
                        {exportError && (
                            <p className="mt-3 text-xs text-rose-300">
                                {exportError}
                            </p>
                        )}
                    </section>
                </main>
            </div>
        </div>
    );
};

export default VideoEditor;
