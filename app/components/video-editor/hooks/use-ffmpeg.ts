"use client";

import * as React from "react";
import {
    Input,
    Output,
    CanvasSink,
    VideoSampleSource,
    VideoSample,
    AudioSampleSink,
    EncodedAudioPacketSource,
    EncodedPacket,
    AudioSample,
    BlobSource,
    Mp4OutputFormat,
    StreamTarget,
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
            const t0 = performance.now();
            const log = (msg: string) =>
                console.log(
                    `[export +${((performance.now() - t0) / 1000).toFixed(2)}s] ${msg}`,
                );

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

            log(
                `output ${outW}×${outH}, ${clips.length} clip(s), resolution="${exportResolution}"`,
            );

            const transform = buildTransform(previewViewport, outW, outH);
            const includeAudio = clips.every((c) => c.hasAudio);

            // Offscreen canvas used ONLY for the overlay slow-path — compositing
            // overlays onto a frame before passing to the encoder.
            const offscreen = new OffscreenCanvas(outW, outH);
            const ctx = offscreen.getContext("2d")!;

            // VideoSampleSource instead of CanvasSource: accepts VideoSample directly,
            // letting the browser hand GPU textures to the encoder without a CPU readback
            // on frames that have no active overlays.
            const videoSource = new VideoSampleSource({
                codec: "avc",
                bitrate: QUALITY_HIGH,
                sizeChangeBehavior: "contain",
            });
            // EncodedAudioPacketSource receives pre-encoded Opus packets.
            // We use a fresh WebCodecs AudioEncoder per 30-second chunk so the
            // encoder never accumulates state across the full clip duration —
            // a long-lived encoder reliably throws "network error" at ~990 s.
            const audioSource = includeAudio
                ? new EncodedAudioPacketSource("opus")
                : null;
            // Decoder config metadata must be sent once with the very first packet.
            let audioMetaSent = false;

            // Mp4OutputFormat writes non-monotonically (seeks back to fix mdat box
            // sizes). StreamTarget receives position-based write ops. We collect them,
            // then at finalise time resolve the small overlapping fixup writes in-place
            // before assembling the Blob — avoiding one giant contiguous ArrayBuffer.
            type WriteOp = { position: number; data: Uint8Array };
            const writeOps: WriteOp[] = [];
            const output = new Output({
                format: new Mp4OutputFormat(),
                target: new StreamTarget(
                    new WritableStream({
                        write(chunk: { type: "write"; data: Uint8Array; position: number }) {
                            writeOps.push({ position: chunk.position, data: chunk.data.slice() });
                        },
                    }),
                    { chunked: true, chunkSize: 16 * 1024 * 1024 },
                ),
            });
            output.addVideoTrack(videoSource);
            if (audioSource) output.addAudioTrack(audioSource);

            log("starting output muxer…");
            await output.start();
            log("muxer started");

            const totalDuration = clips.reduce(
                (s, c) => s + (c.end - c.start),
                0,
            );
            let timeOffset = 0;

            for (let ci = 0; ci < clips.length; ci++) {
                const clip = clips[ci];
                const clipDuration = clip.end - clip.start;
                const clipLabel = `clip ${ci + 1}/${clips.length} "${clip.name}" [${clip.start.toFixed(2)}s–${clip.end.toFixed(2)}s]`;

                log(`${clipLabel} — opening inputs`);

                // Open a dedicated Input per track type so that each reader can
                // seek independently without conflicting with the other.
                const videoInput = new Input({
                    source: new BlobSource(clip.file),
                    formats: ALL_FORMATS,
                });
                const audioInput = audioSource
                    ? new Input({
                          source: new BlobSource(clip.file),
                          formats: ALL_FORMATS,
                      })
                    : null;

                try {
                    const videoTrack = await videoInput.getPrimaryVideoTrack();
                    if (!videoTrack)
                        throw new Error(
                            `No video track in clip "${clip.name}"`,
                        );

                    log(
                        `${clipLabel} — decoding video frames (source ${clip.width}×${clip.height} → output ${outW}×${outH})`,
                    );
                    let frameCount = 0;
                    // Per-step accumulators (ms)
                    let msWaitDecode = 0,
                        msDraw = 0,
                        msEncode = 0;
                    let tFrameStart = performance.now();

                    // Decode frames — CanvasSink scales to outW×outH letterboxed.
                    const videoSink = new CanvasSink(videoTrack, {
                        width: outW,
                        height: outH,
                        fit: "contain",
                    });
                    for await (const frame of videoSink.canvases(
                        clip.start,
                        clip.end,
                    )) {
                        // ① How long we waited for this frame from the decoder
                        const tGotFrame = performance.now();
                        msWaitDecode += tGotFrame - tFrameStart;

                        // Timestamp in output timeline (seconds).
                        const outputTs =
                            timeOffset +
                            Math.max(0, frame.timestamp - clip.start);

                        const activeOverlays = overlays.filter(
                            (o) => outputTs >= o.startTime && outputTs <= o.endTime,
                        );

                        let videoSample: VideoSample;
                        if (activeOverlays.length === 0) {
                            // ② FAST PATH — no overlay active on this frame.
                            // Wrap CanvasSink's already-resized canvas directly as a VideoSample.
                            // The GPU texture travels straight to VideoSampleSource without
                            // a canvas-to-canvas blit or a CPU readback.
                            videoSample = new VideoSample(frame.canvas, {
                                timestamp: outputTs,
                                duration: frame.duration,
                            });
                        } else {
                            // ② SLOW PATH — composite overlays onto our offscreen canvas.
                            ctx.fillStyle = "#000";
                            ctx.fillRect(0, 0, outW, outH);
                            ctx.drawImage(frame.canvas, 0, 0);
                            for (const overlay of activeOverlays) {
                                renderOverlay(ctx, overlay, transform);
                            }
                            videoSample = new VideoSample(offscreen, {
                                timestamp: outputTs,
                                duration: frame.duration,
                            });
                        }
                        const tAfterDraw = performance.now();
                        msDraw += tAfterDraw - tGotFrame;

                        // ③ Hand VideoSample to encoder.
                        await videoSource.add(videoSample);
                        videoSample.close();
                        const tAfterEncode = performance.now();
                        msEncode += tAfterEncode - tAfterDraw;

                        frameCount++;
                        tFrameStart = performance.now();

                        // Log breakdown every 30 frames (~1s of footage)
                        if (frameCount % 30 === 0) {
                            const avgDecode = (
                                msWaitDecode / frameCount
                            ).toFixed(1);
                            const avgDraw = (msDraw / frameCount).toFixed(1);
                            const avgEncode = (msEncode / frameCount).toFixed(
                                1,
                            );
                            const avgTotal = (
                                (msWaitDecode + msDraw + msEncode) /
                                frameCount
                            ).toFixed(1);
                            log(
                                `${clipLabel} — frame ${frameCount} avg/frame: ` +
                                    `decode-wait=${avgDecode}ms  canvas-draw=${avgDraw}ms  encode+readback=${avgEncode}ms  total=${avgTotal}ms`,
                            );
                        }

                        if (totalDuration > 0) {
                            setExportProgress(
                                Math.min(
                                    99,
                                    Math.round(
                                        (outputTs / totalDuration) * 100,
                                    ),
                                ),
                            );
                        }
                    }

                    if (frameCount > 0) {
                        const avgDecode = (msWaitDecode / frameCount).toFixed(
                            1,
                        );
                        const avgDraw = (msDraw / frameCount).toFixed(1);
                        const avgEncode = (msEncode / frameCount).toFixed(1);
                        const gpuReadbackMBps = (
                            (outW * outH * 4 * frameCount) /
                            1_048_576 /
                            (msEncode / 1000)
                        ).toFixed(0);
                        log(
                            `${clipLabel} — video done: ${frameCount} frames\n` +
                                `  avg/frame → decode-wait=${avgDecode}ms | canvas-draw=${avgDraw}ms | encode+readback=${avgEncode}ms\n` +
                                `  encode+readback implies ~${gpuReadbackMBps} MB/s GPU→CPU bandwidth (${outW}×${outH}×4 B/frame)`,
                        );
                    }
                } finally {
                    videoInput.dispose();
                }

                // Process audio — decode, resample to 48 kHz stereo, add to output.
                if (audioSource && audioInput) {
                    try {
                        const audioTrack =
                            await audioInput.getPrimaryAudioTrack();
                        if (audioTrack) {
                            const nativeSampleRate =
                                await audioTrack.getSampleRate();
                            const nativeChannels =
                                await audioTrack.getNumberOfChannels();
                            log(
                                `${clipLabel} — decoding audio (native ${nativeSampleRate} Hz, ${nativeChannels} ch)`,
                            );

                            // Process in 30-second chunks to avoid accumulating hundreds
                            // of MB of decoded audio frames in memory for long clips.
                            const CHUNK_SECS = 30;
                            const audioSink = new AudioSampleSink(audioTrack);
                            let chunk: AudioSample[] = [];
                            let chunkDuration = 0;
                            let audioOutputTs = timeOffset; // running output-timeline cursor
                            let totalPackets = 0;
                            let chunksProcessed = 0;

                            const flushChunk = async () => {
                                if (chunk.length === 0) return;
                                const tR = performance.now();
                                const resampled = await resampleTo48k(chunk);
                                for (const s of chunk) s.close();
                                chunk = [];
                                chunkDuration = 0;

                                // AudioSamples with correct output-timeline timestamps.
                                const audioSamples = AudioSample.fromAudioBuffer(
                                    resampled,
                                    audioOutputTs,
                                );

                                // Encode this chunk with a brand-new AudioEncoder so the
                                // encoder's internal state never grows beyond 30 s worth.
                                type CapturedPacket = {
                                    packet: EncodedPacket;
                                    meta: EncodedAudioChunkMetadata | undefined;
                                };
                                const captured: CapturedPacket[] = [];
                                await new Promise<void>((resolve, reject) => {
                                    const enc = new AudioEncoder({
                                        output: (chunk, meta) => {
                                            captured.push({
                                                packet: EncodedPacket.fromEncodedChunk(chunk),
                                                meta: meta ?? undefined,
                                            });
                                        },
                                        error: reject,
                                    });
                                    try {
                                        enc.configure({
                                            codec: "opus",
                                            sampleRate: 48_000,
                                            numberOfChannels: 2,
                                            bitrate: 128_000,
                                        });
                                        for (const s of audioSamples) {
                                            const ad = s.toAudioData();
                                            enc.encode(ad);
                                            ad.close();
                                            s.close();
                                        }
                                        enc.flush().then(() => { enc.close(); resolve(); }).catch(reject);
                                    } catch (err) {
                                        try { enc.close(); } catch { /* ignore */ }
                                        reject(err);
                                    }
                                });

                                for (const { packet, meta } of captured) {
                                    // Pass decoder config with the very first packet only.
                                    const sendMeta = !audioMetaSent ? meta : undefined;
                                    await audioSource!.add(packet, sendMeta);
                                    if (!audioMetaSent && meta) audioMetaSent = true;
                                }

                                // Advance by the encoder's actual output end, not resampled.duration.
                                // Opus pads the last partial frame to a 1024-sample boundary,
                                // so the last encoded packet always ends AFTER resampled.duration.
                                // Using resampled.duration as the next chunk's start would place
                                // it before the last packet's timestamp → muxer rejects it.
                                const lastPacket = captured[captured.length - 1];
                                const nextStart = lastPacket
                                    ? lastPacket.packet.timestamp + lastPacket.packet.duration
                                    : audioOutputTs + resampled.duration;

                                log(
                                    `${clipLabel} — audio chunk ${++chunksProcessed} encoded` +
                                    ` (${resampled.duration.toFixed(3)}s raw → next chunk starts at ${nextStart.toFixed(4)}s,` +
                                    ` resample+encode ${((performance.now() - tR) / 1000).toFixed(2)}s)`,
                                );
                                audioOutputTs = nextStart;
                            };

                            for await (const sample of audioSink.samples(
                                clip.start,
                                clip.end,
                            )) {
                                // Clone first, then close the generator-owned sample
                                // immediately. Without this, every un-closed AudioSample
                                // holds ~8 KB of AudioData; for a 1129s clip that is
                                // ~420 MB of uncollected memory, which starves the encoder.
                                const cloned = sample.clone();
                                sample.close();
                                chunk.push(cloned);
                                chunkDuration += cloned.duration;
                                totalPackets++;
                                if (chunkDuration >= CHUNK_SECS) {
                                    await flushChunk();
                                }
                            }
                            await flushChunk();

                            log(`${clipLabel} — audio done (${totalPackets} packets, ${chunksProcessed} chunk(s))`);
                        } else {
                            log(`${clipLabel} — no audio track found`);
                        }
                    } finally {
                        audioInput.dispose();
                    }
                }

                timeOffset += clipDuration;
                log(
                    `${clipLabel} — done (timeOffset now ${timeOffset.toFixed(2)}s)`,
                );
            }

            log("finalizing output…");
            await output.finalize();
            log(
                `finalize done — total ${((performance.now() - t0) / 1000).toFixed(2)}s`,
            );
            setExportProgress(100);

            if (writeOps.length === 0)
                throw new Error("Output buffer is empty after finalize");

            // Sort by position, then apply small fixup writes (e.g. mdat box size)
            // in-place into whichever earlier chunk already covers those bytes.
            writeOps.sort((a, b) => a.position - b.position);
            for (let i = writeOps.length - 1; i > 0; i--) {
                const op = writeOps[i];
                for (let j = 0; j < i; j++) {
                    const prev = writeOps[j];
                    const relOffset = op.position - prev.position;
                    if (relOffset >= 0 && relOffset < prev.data.byteLength) {
                        // op lands inside prev — patch the bytes in-place and drop op
                        prev.data.set(
                            op.data.subarray(0, prev.data.byteLength - relOffset),
                            relOffset,
                        );
                        writeOps.splice(i, 1);
                        break;
                    }
                }
            }
            log(`assembling blob from ${writeOps.length} chunk(s)`);
            const blob = new Blob(writeOps.map((op) => op.data) as BlobPart[], { type: "video/mp4" });
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
    const mergeCtx = new OfflineAudioContext(
        srcCh,
        Math.max(1, totalFrames),
        srcRate,
    );
    const merged = mergeCtx.createBuffer(srcCh, totalFrames, srcRate);
    let offset = 0;
    for (const sample of samples) {
        const ab = sample.toAudioBuffer();
        for (let ch = 0; ch < srcCh; ch++) {
            merged
                .getChannelData(ch)
                .set(
                    ab.getChannelData(Math.min(ch, ab.numberOfChannels - 1)),
                    offset,
                );
        }
        offset += sample.numberOfFrames;
    }

    if (srcRate === TARGET_RATE && srcCh === TARGET_CH) return merged;

    // Resample + remix via a second OfflineAudioContext.
    const targetFrames = Math.ceil((totalFrames * TARGET_RATE) / srcRate);
    const resCtx = new OfflineAudioContext(
        TARGET_CH,
        Math.max(1, targetFrames),
        TARGET_RATE,
    );
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
function buildTransform(
    viewport: Viewport,
    outW: number,
    outH: number,
): Transform {
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
