"use client";

import * as React from "react";
import {
    Input,
    Output,
    CanvasSink,
    CanvasSource,
    AudioSampleSink,
    AudioSampleSource,
    AudioSample,
    BlobSource,
    Mp4OutputFormat,
    BufferTarget,
    ALL_FORMATS,
    QUALITY_HIGH,
} from "mediabunny";
import type { Clip, Overlay, ExportResolution } from "../types";

type Viewport = { width: number; height: number };
type Transform = {
    vx: (n: number) => number;
    vy: (n: number) => number;
    vw: (n: number) => number;
    vh: (n: number) => number;
};

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
            // Resolve output dimensions from first clip, adjusted for export resolution.
            let outW = clips[0].width;
            let outH = clips[0].height;
            if (exportResolution === "720p") {
                [outW, outH] = scaleDims(outW, outH, 720);
            } else if (exportResolution === "1080p") {
                [outW, outH] = scaleDims(outW, outH, 1080);
            }
            // AVC encoder requires even dimensions.
            outW = Math.round(outW / 2) * 2;
            outH = Math.round(outH / 2) * 2;

            const transform = buildTransform(previewViewport, outW, outH);
            const includeAudio = clips.every((c) => c.hasAudio);

            // Single OffscreenCanvas reused for every frame — captures current pixel
            // state when canvasSource.add() is called.
            const offscreen = new OffscreenCanvas(outW, outH);
            const ctx = offscreen.getContext("2d")!;

            const canvasSource = new CanvasSource(offscreen, {
                codec: "avc",
                bitrate: QUALITY_HIGH,
                // Subsequent clips may differ in size; contain them instead of erroring.
                sizeChangeBehavior: "contain",
            });
            const audioSource = includeAudio
                ? new AudioSampleSource({ codec: "opus", bitrate: 128_000 })
                : null;

            const output = new Output({
                format: new Mp4OutputFormat(),
                target: new BufferTarget(),
            });
            output.addVideoTrack(canvasSource);
            if (audioSource) output.addAudioTrack(audioSource);
            await output.start();

            const totalDuration = clips.reduce((s, c) => s + (c.end - c.start), 0);
            let timeOffset = 0;

            for (const clip of clips) {
                const clipDuration = clip.end - clip.start;

                // Open a dedicated Input per track type so that each reader can
                // seek independently without conflicting with the other.
                const videoInput = new Input({
                    source: new BlobSource(clip.file),
                    formats: ALL_FORMATS,
                });
                const audioInput = audioSource
                    ? new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS })
                    : null;

                try {
                    const videoTrack = await videoInput.getPrimaryVideoTrack();
                    if (!videoTrack)
                        throw new Error(`No video track in clip "${clip.name}"`);

                    // Decode frames — CanvasSink scales to outW×outH letterboxed.
                    const videoSink = new CanvasSink(videoTrack, {
                        width: outW,
                        height: outH,
                        fit: "contain",
                    });
                    for await (const frame of videoSink.canvases(clip.start, clip.end)) {
                        ctx.fillStyle = "#000";
                        ctx.fillRect(0, 0, outW, outH);
                        ctx.drawImage(frame.canvas, 0, 0);

                        // Timestamp in output timeline (seconds).
                        const outputTs =
                            timeOffset + Math.max(0, frame.timestamp - clip.start);

                        for (const overlay of overlays) {
                            if (
                                outputTs >= overlay.startTime &&
                                outputTs <= overlay.endTime
                            ) {
                                renderOverlay(ctx, overlay, transform);
                            }
                        }

                        await canvasSource.add(outputTs, frame.duration);

                        if (totalDuration > 0) {
                            setExportProgress(
                                Math.min(99, Math.round((outputTs / totalDuration) * 100)),
                            );
                        }
                    }
                } finally {
                    videoInput.dispose();
                }

                // Process audio — decode, resample to 48 kHz stereo, add to output.
                if (audioSource && audioInput) {
                    try {
                        const audioTrack = await audioInput.getPrimaryAudioTrack();
                        if (audioTrack) {
                            const audioSink = new AudioSampleSink(audioTrack);
                            const raw: AudioSample[] = [];
                            for await (const sample of audioSink.samples(
                                clip.start,
                                clip.end,
                            )) {
                                raw.push(sample.clone());
                            }
                            if (raw.length > 0) {
                                const resampled = await resampleTo48k(raw);
                                for (const s of raw) s.close();
                                const out = AudioSample.fromAudioBuffer(resampled, timeOffset);
                                for (const s of out) {
                                    await audioSource.add(s);
                                    s.close();
                                }
                            }
                        }
                    } finally {
                        audioInput.dispose();
                    }
                }

                timeOffset += clipDuration;
            }

            await output.finalize();
            setExportProgress(100);

            const buf = output.target.buffer;
            if (!buf) throw new Error("Output buffer is empty after finalize");

            const blob = new Blob([buf], { type: "video/mp4" });
            const downloadUrl = URL.createObjectURL(blob);
            setExportUrl(downloadUrl);

            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = "export.mp4";
            a.click();

            if (!includeAudio) {
                setExportError(
                    "Exported without audio. Some clips may not include audio tracks.",
                );
            }
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

/**
 * Merge raw AudioSamples from a clip and resample them to 48 kHz stereo using
 * OfflineAudioContext. This normalises differing source rates (44.1 kHz, 48 kHz, etc.)
 * so the Opus encoder receives a consistent format across all clips.
 */
async function resampleTo48k(samples: AudioSample[]): Promise<AudioBuffer> {
    const TARGET_RATE = 48_000;
    const TARGET_CH = 2;
    const srcRate = samples[0].sampleRate;
    const srcCh = samples[0].numberOfChannels;

    // Merge decoded samples into one AudioBuffer at the native rate.
    const totalFrames = samples.reduce((n, s) => n + s.numberOfFrames, 0);
    const mergeCtx = new OfflineAudioContext(srcCh, Math.max(1, totalFrames), srcRate);
    const merged = mergeCtx.createBuffer(srcCh, totalFrames, srcRate);
    let offset = 0;
    for (const sample of samples) {
        const ab = sample.toAudioBuffer();
        for (let ch = 0; ch < srcCh; ch++) {
            merged.getChannelData(ch).set(ab.getChannelData(Math.min(ch, ab.numberOfChannels - 1)), offset);
        }
        offset += sample.numberOfFrames;
    }

    if (srcRate === TARGET_RATE && srcCh === TARGET_CH) return merged;

    // Resample + remix via a second OfflineAudioContext.
    const targetFrames = Math.ceil(totalFrames * TARGET_RATE / srcRate);
    const resCtx = new OfflineAudioContext(TARGET_CH, Math.max(1, targetFrames), TARGET_RATE);
    const src = resCtx.createBufferSource();
    src.buffer = merged;
    src.connect(resCtx.destination);
    src.start();
    return resCtx.startRendering();
}

/** Scale dimensions so the short side equals `target`, keeping aspect ratio and even values. */
function scaleDims(w: number, h: number, target: number): [number, number] {
    const isLandscape = w >= h;
    const [shortSide, longSide] = isLandscape ? [h, w] : [w, h];
    const scaled = Math.round((target * longSide) / shortSide / 2) * 2;
    return isLandscape ? [scaled, target] : [target, scaled];
}

/** Build coordinate transforms from preview-canvas space to video-pixel space. */
function buildTransform(viewport: Viewport, outW: number, outH: number): Transform {
    const clipAspect = outW / outH;
    const canvasAspect = viewport.width / viewport.height;
    let renderedW: number, renderedH: number, offsetX: number, offsetY: number;
    if (clipAspect > canvasAspect) {
        renderedW = viewport.width;
        renderedH = viewport.width / clipAspect;
        offsetX = 0;
        offsetY = (viewport.height - renderedH) / 2;
    } else {
        renderedH = viewport.height;
        renderedW = viewport.height * clipAspect;
        offsetX = (viewport.width - renderedW) / 2;
        offsetY = 0;
    }
    const sx = outW / renderedW;
    const sy = outH / renderedH;
    return {
        vx: (n) => Math.round((n - offsetX) * sx),
        vy: (n) => Math.round((n - offsetY) * sy),
        vw: (n) => Math.round(n * sx),
        vh: (n) => Math.round(n * sy),
    };
}

function renderOverlay(
    ctx: OffscreenCanvasRenderingContext2D,
    overlay: Overlay,
    t: Transform,
) {
    ctx.save();
    switch (overlay.type) {
        case "text": {
            ctx.font = `${t.vh(overlay.fontSize)}px sans-serif`;
            ctx.fillStyle = overlay.color;
            // Baseline shift: position y is the top-left of the text box.
            ctx.fillText(
                overlay.text,
                t.vx(overlay.x),
                t.vy(overlay.y) + t.vh(overlay.fontSize),
            );
            break;
        }
        case "rect": {
            const x = t.vx(overlay.x);
            const y = t.vy(overlay.y);
            const w = t.vw(overlay.width);
            const h = t.vh(overlay.height);
            if (overlay.fillEnabled) {
                ctx.fillStyle = overlay.color;
                ctx.fillRect(x, y, w, h);
            }
            if (overlay.strokeWidth > 0) {
                ctx.strokeStyle = overlay.strokeColor;
                ctx.lineWidth = Math.max(1, t.vh(overlay.strokeWidth));
                ctx.strokeRect(x, y, w, h);
            }
            break;
        }
        case "circle": {
            const cx = t.vx(overlay.x + overlay.width / 2);
            const cy = t.vy(overlay.y + overlay.height / 2);
            const rx = Math.max(1, t.vw(overlay.width / 2));
            const ry = Math.max(1, t.vh(overlay.height / 2));
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            if (overlay.fillEnabled) {
                ctx.fillStyle = overlay.color;
                ctx.fill();
            }
            if (overlay.strokeWidth > 0) {
                ctx.strokeStyle = overlay.strokeColor;
                ctx.lineWidth = Math.max(1, t.vh(overlay.strokeWidth));
                ctx.stroke();
            }
            break;
        }
        case "line": {
            ctx.beginPath();
            ctx.moveTo(t.vx(overlay.x), t.vy(overlay.y));
            ctx.lineTo(
                t.vx(overlay.x + overlay.width),
                t.vy(overlay.y + overlay.height),
            );
            ctx.strokeStyle = overlay.strokeColor;
            ctx.lineWidth = Math.max(1, t.vh(overlay.strokeWidth));
            ctx.stroke();
            break;
        }
    }
    ctx.restore();
}
