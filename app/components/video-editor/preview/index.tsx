"use client";

import * as React from "react";

import type { Clip, Overlay } from "../types";

type VideoEditorPreviewProps = {
    clips: Clip[];
    overlays: Overlay[];
    currentTime: number;
    isPlaying: boolean;
    selectedOverlayId: string | null;
    onTimeChange: (time: number) => void;
    onPlaybackEnd: () => void;
    onOverlaySelect: (id: string | null) => void;
    onOverlayPositionChange: (id: string, x: number, y: number) => void;
    onOverlayResize: (id: string, x: number, y: number, w: number, h: number) => void;
    onPlayStateChange?: (isPlaying: boolean) => void;
    onViewportChange?: (width: number, height: number) => void;
};

type ClipAtTime = {
    clip: Clip;
    index: number;
    clipStart: number;
    clipLength: number;
    localTime: number;
};

const findClipAtTime = (clips: Clip[], time: number): ClipAtTime | null => {
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
        const clip = clips[index];
        const length = clip.end - clip.start;
        if (time <= cursor + length || index === clips.length - 1) {
            return { clip, index, clipStart: cursor, clipLength: length, localTime: clip.start + Math.max(0, time - cursor) };
        }
        cursor += length;
    }
    return null;
};

// ── Resize handles ───────────────────────────────────────────────────────────

const H = 5; // half-size of each handle square in CSS px

type HandleId = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

const HANDLES: { id: HandleId; cx: number; cy: number; cursor: string }[] = [
    { id: "tl", cx: 0,   cy: 0,   cursor: "nw-resize" },
    { id: "tc", cx: 0.5, cy: 0,   cursor: "n-resize"  },
    { id: "tr", cx: 1,   cy: 0,   cursor: "ne-resize" },
    { id: "ml", cx: 0,   cy: 0.5, cursor: "w-resize"  },
    { id: "mr", cx: 1,   cy: 0.5, cursor: "e-resize"  },
    { id: "bl", cx: 0,   cy: 1,   cursor: "sw-resize" },
    { id: "bc", cx: 0.5, cy: 1,   cursor: "s-resize"  },
    { id: "br", cx: 1,   cy: 1,   cursor: "se-resize" },
];

const handlePos = (o: Overlay, h: (typeof HANDLES)[0]) => ({
    x: o.x + h.cx * o.width,
    y: o.y + h.cy * o.height,
});

const findHandle = (px: number, py: number, o: Overlay) => {
    for (const h of HANDLES) {
        const p = handlePos(o, h);
        if (Math.abs(px - p.x) <= H + 3 && Math.abs(py - p.y) <= H + 3) return h;
    }
    return null;
};

const applyResize = (
    hid: HandleId,
    start: { x: number; y: number; width: number; height: number },
    dx: number,
    dy: number,
    lockAspect: boolean,
) => {
    let { x, y, width, height } = start;

    if (hid.includes("l")) { x += dx; width -= dx; }
    else if (hid.includes("r")) { width += dx; }

    if (hid.includes("t")) { y += dy; height -= dy; }
    else if (hid.includes("b")) { height += dy; }

    if (lockAspect) {
        // Force square — use whichever dimension changed most
        const size = Math.max(20, Math.abs(width), Math.abs(height));
        if (hid.includes("l")) x = start.x + start.width - size;
        if (hid.includes("t")) y = start.y + start.height - size;
        width = size;
        height = size;
    }

    return { x, y, width: Math.max(20, width), height: Math.max(20, height) };
};

// ── Component ────────────────────────────────────────────────────────────────

const VideoEditorPreview = ({
    clips,
    overlays,
    currentTime,
    isPlaying,
    selectedOverlayId,
    onTimeChange,
    onPlaybackEnd,
    onOverlaySelect,
    onOverlayPositionChange,
    onOverlayResize,
    onPlayStateChange,
    onViewportChange,
}: VideoEditorPreviewProps) => {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

    type DragState =
        | { type: "move"; id: string; offsetX: number; offsetY: number }
        | {
              type: "resize";
              id: string;
              handle: HandleId;
              startPx: number;
              startPy: number;
              startGeom: { x: number; y: number; width: number; height: number };
              lockAspect: boolean;
          };
    const dragRef = React.useRef<DragState | null>(null);
    const [cursor, setCursor] = React.useState("default");

    const totalDuration = React.useMemo(
        () => clips.reduce((t, c) => t + (c.end - c.start), 0),
        [clips],
    );

    const activeClip = React.useMemo(
        () => findClipAtTime(clips, currentTime),
        [clips, currentTime],
    );

    React.useEffect(() => {
        const video = videoRef.current;
        if (!video || !activeClip) return;
        if (video.src !== activeClip.clip.url) video.src = activeClip.clip.url;
        if (Math.abs(video.currentTime - activeClip.localTime) > 0.1)
            video.currentTime = activeClip.localTime;
        if (isPlaying) void video.play();
        else video.pause();
    }, [activeClip, isPlaying]);

    const handleTimeUpdate = React.useCallback(() => {
        if (!videoRef.current || !activeClip) return;
        const localOffset = Math.max(0, videoRef.current.currentTime - activeClip.clip.start);
        const nextTime = Math.min(totalDuration, activeClip.clipStart + localOffset);
        onTimeChange(nextTime);
        if (videoRef.current.currentTime >= activeClip.clip.end - 0.05) {
            const nextStart = activeClip.clipStart + activeClip.clipLength;
            if (nextStart >= totalDuration) { onPlaybackEnd(); return; }
            onTimeChange(nextStart + 0.01);
        }
    }, [activeClip, onPlaybackEnd, onTimeChange, totalDuration]);

    const resizeCanvas = React.useCallback(() => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;
        const width = video.clientWidth || 1;
        const height = video.clientHeight || 1;
        const scale = window.devicePixelRatio || 1;
        canvas.width = width * scale;
        canvas.height = height * scale;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
        onViewportChange?.(width, height);
    }, [onViewportChange]);

    React.useEffect(() => {
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);
        return () => window.removeEventListener("resize", resizeCanvas);
    }, [resizeCanvas]);

    // ── Canvas draw ──────────────────────────────────────────────────────────
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const visible = overlays.filter(
            (o) => currentTime >= o.startTime && currentTime <= o.endTime,
        );

        for (const o of visible) {
            ctx.setLineDash([]);

            if (o.type === "text") {
                ctx.font = `${o.fontSize}px sans-serif`;
                ctx.fillStyle = o.color;
                ctx.fillText(o.text, o.x, o.y + o.fontSize);
            } else if (o.type === "line") {
                ctx.strokeStyle = o.strokeColor;
                ctx.lineWidth = Math.max(1, o.strokeWidth);
                ctx.beginPath();
                ctx.moveTo(o.x, o.y);
                ctx.lineTo(o.x + o.width, o.y + o.height);
                ctx.stroke();
            } else if (o.type === "rect") {
                if (o.fillEnabled) {
                    ctx.fillStyle = o.color;
                    ctx.fillRect(o.x, o.y, o.width, o.height);
                }
                if (o.strokeWidth > 0) {
                    ctx.strokeStyle = o.strokeColor;
                    ctx.lineWidth = o.strokeWidth;
                    ctx.strokeRect(o.x, o.y, o.width, o.height);
                }
            } else if (o.type === "circle") {
                const rx = o.width / 2;
                const ry = o.height / 2;
                ctx.beginPath();
                ctx.ellipse(o.x + rx, o.y + ry, rx, ry, 0, 0, Math.PI * 2);
                if (o.fillEnabled) {
                    ctx.fillStyle = o.color;
                    ctx.fill();
                }
                if (o.strokeWidth > 0) {
                    ctx.strokeStyle = o.strokeColor;
                    ctx.lineWidth = o.strokeWidth;
                    ctx.stroke();
                }
            }

            // Selection box + resize handles
            if (o.id === selectedOverlayId) {
                ctx.strokeStyle = "rgba(255,255,255,0.8)";
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(o.x - 4, o.y - 4, o.width + 8, o.height + 8);
                ctx.setLineDash([]);

                // Draw 8 resize handles
                for (const h of HANDLES) {
                    const p = handlePos(o, h);
                    ctx.fillStyle = "white";
                    ctx.strokeStyle = "rgba(15,23,42,0.9)";
                    ctx.lineWidth = 1;
                    ctx.fillRect(p.x - H, p.y - H, H * 2, H * 2);
                    ctx.strokeRect(p.x - H, p.y - H, H * 2, H * 2);
                }
            }
        }
    }, [currentTime, overlays, selectedOverlayId]);

    // ── Pointer helpers ──────────────────────────────────────────────────────
    const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const r = canvasRef.current!.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const hitOverlay = (px: number, py: number) => {
        for (let i = overlays.length - 1; i >= 0; i--) {
            const o = overlays[i];
            if (px >= o.x && px <= o.x + o.width && py >= o.y && py <= o.y + o.height)
                return o;
        }
        return null;
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const { x, y } = getPoint(e);

        // Check resize handle first (only on selected overlay)
        if (selectedOverlayId) {
            const sel = overlays.find((o) => o.id === selectedOverlayId);
            if (sel) {
                const h = findHandle(x, y, sel);
                if (h) {
                    dragRef.current = {
                        type: "resize",
                        id: sel.id,
                        handle: h.id,
                        startPx: x,
                        startPy: y,
                        startGeom: { x: sel.x, y: sel.y, width: sel.width, height: sel.height },
                        lockAspect: sel.type === "circle",
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    return;
                }
            }
        }

        // Otherwise drag
        const hit = hitOverlay(x, y);
        if (!hit) { onOverlaySelect(null); return; }
        dragRef.current = { type: "move", id: hit.id, offsetX: x - hit.x, offsetY: y - hit.y };
        onOverlaySelect(hit.id);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const { x, y } = getPoint(e);
        const state = dragRef.current;

        if (!state) {
            // Update cursor for hover feedback
            if (selectedOverlayId) {
                const sel = overlays.find((o) => o.id === selectedOverlayId);
                if (sel) {
                    const h = findHandle(x, y, sel);
                    if (h) { setCursor(h.cursor); return; }
                }
            }
            setCursor(hitOverlay(x, y) ? "move" : "default");
            return;
        }

        if (state.type === "move") {
            onOverlayPositionChange(
                state.id,
                Math.max(0, x - state.offsetX),
                Math.max(0, y - state.offsetY),
            );
        } else {
            const dx = x - state.startPx;
            const dy = y - state.startPy;
            const g = applyResize(state.handle, state.startGeom, dx, dy, state.lockAspect);
            onOverlayResize(state.id, g.x, g.y, g.width, g.height);
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        dragRef.current = null;
        setCursor("default");
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    return (
        <div className="flex flex-1 flex-col gap-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-3xl border border-white/5 bg-black/80 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <video
                    ref={videoRef}
                    className="h-full w-full object-contain"
                    controls
                    preload="metadata"
                    playsInline
                    onLoadedMetadata={resizeCanvas}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => onPlayStateChange?.(true)}
                    onPause={() => onPlayStateChange?.(false)}
                    onEnded={() => { onPlayStateChange?.(false); onPlaybackEnd(); }}
                >
                    Your browser does not support the video tag.
                </video>
                <canvas
                    ref={canvasRef}
                    className="absolute left-0 top-0 h-full w-full"
                    style={{ cursor }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                />
                {clips.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                        Upload a video to start editing.
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoEditorPreview;
