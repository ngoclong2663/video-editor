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
    EncodedPacketSink,
    AudioSample,
    BlobSource,
    Mp4OutputFormat,
    StreamTarget,
    ALL_FORMATS,
    QUALITY_HIGH,
} from "mediabunny";
import type { AudioCodec } from "mediabunny";
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

        // File System Access API is required — encoded output for long 1080p
        // clips can exceed 1 GB, which doesn't fit in browser RAM as a single
        // ArrayBuffer or Blob. Stream directly to disk instead.
        const win = window as Window & {
            showSaveFilePicker?: (opts: {
                suggestedName?: string;
                types?: Array<{ description?: string; accept: Record<string, string[]> }>;
            }) => Promise<FileSystemFileHandle>;
        };
        if (!win.showSaveFilePicker) {
            setExportError(
                "Export requires the File System Access API (Chrome, Edge, Brave, Opera).",
            );
            return;
        }

        // Must request the file handle from a user-gesture-driven call site;
        // the export button click satisfies this.
        let fileHandle: FileSystemFileHandle;
        try {
            fileHandle = await win.showSaveFilePicker({
                suggestedName: "export.mp4",
                types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }],
            });
        } catch (err) {
            // User dismissed the picker — silent return, no error UI.
            if (err instanceof DOMException && err.name === "AbortError") return;
            setExportError(err instanceof Error ? err.message : "Failed to open save dialog");
            return;
        }

        setIsExporting(true);
        setExportProgress(0);
        setExportError(null);
        setExportUrl(null);

        let fileWritable: FileSystemWritableFileStream | null = null;

        try {
            fileWritable = await fileHandle.createWritable({ keepExistingData: false });

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

            // Pre-flight: probe each clip's audio track. Three possible outcomes:
            //   • "anchored" — pick clip[0]'s config as the target. Clips with
            //     matching configs get passthrough (no codec runs at all).
            //     Mismatched clips get decoded → resampled → re-encoded in the
            //     target codec. As long as the LONGEST clip is the anchor, the
            //     long-clip decoder/encoder limit is never hit (passthrough
            //     skips both for it).
            //   • "transcode" — anchor codec can't be encoded in this browser,
            //     fall back to Opus 48kHz stereo for all clips. May fail at
            //     ~600-1000s of audio on the long clip.
            //   • "none" — at least one clip lacks an audio track.
            type AudioTarget = {
                codec: AudioCodec;          // mediabunny codec name (for muxer)
                decoderConfig: AudioDecoderConfig; // for first-packet metadata + WebCodecs codec string
                sampleRate: number;
                numberOfChannels: number;
            };
            type AudioStrategy =
                | { kind: "anchored"; target: AudioTarget; clipMatches: boolean[] }
                | { kind: "transcode" }
                | { kind: "none" };
            let audioStrategy: AudioStrategy = { kind: "none" };
            if (includeAudio) {
                audioStrategy = await probeAudioStrategy(clips, log);
            }

            // Choose output audio codec from the strategy. For "anchored", we
            // reuse the anchor's codec (typically AAC) so passthrough clips can
            // remux directly. For "transcode" fallback we use Opus.
            const audioSource =
                audioStrategy.kind === "anchored"
                    ? new EncodedAudioPacketSource(audioStrategy.target.codec)
                    : audioStrategy.kind === "transcode"
                      ? new EncodedAudioPacketSource("opus")
                      : null;
            // Decoder config metadata must be sent once with the very first packet.
            let audioMetaSent = false;

            // Mp4OutputFormat writes non-monotonically (it seeks back to fix the
            // mdat box size header). FileSystemWritableFileStream natively
            // supports random writes at a position, so each muxer chunk goes
            // straight to disk — no in-memory accumulation, no overlap fixup.
            let bytesWritten = 0;
            const output = new Output({
                format: new Mp4OutputFormat(),
                target: new StreamTarget(
                    new WritableStream({
                        async write(chunk: { type: "write"; data: Uint8Array; position: number }) {
                            try {
                                await fileWritable!.write({
                                    type: "write",
                                    position: chunk.position,
                                    data: chunk.data as BufferSource,
                                });
                            } catch (e) {
                                log(`!! disk write failed at pos ${chunk.position} (${chunk.data.byteLength} B, total ${(bytesWritten / 1_048_576).toFixed(1)} MiB): ${(e as Error).message}`);
                                throw e;
                            }
                            bytesWritten = Math.max(bytesWritten, chunk.position + chunk.data.byteLength);
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
            // Tracks the actual end of the last audio packet across clips.
            // timeOffset advances by clipDuration (video-based) but Opus
            // frame-boundary padding causes each clip's audio to end slightly
            // AFTER timeOffset. Without this cursor the next clip's audio would
            // start before the previous clip's audio ended → muxer GOP error.
            let audioClipOutputTs = 0;

            for (let ci = 0; ci < clips.length; ci++) {
                const clip = clips[ci];
                const clipDuration = clip.end - clip.start;
                const clipLabel = `clip ${ci + 1}/${clips.length} "${clip.name}" [${clip.start.toFixed(2)}s–${clip.end.toFixed(2)}s]`;

                log(`${clipLabel} — opening video input`);

                // videoInput is opened once per clip. audioInput is created per
                // audio segment (every N chunks) so the WebCodecs AudioDecoder
                // never accumulates state past its failure point (~600-1000 s).
                const videoInput = new Input({
                    source: new BlobSource(clip.file),
                    formats: ALL_FORMATS,
                });

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

                // Process audio. Three paths per clip:
                //   • passthrough: clip matches the anchor target → remux raw
                //     source packets. No decoder, no encoder.
                //   • transcode-to-anchor: clip differs from anchor → decode,
                //     resample to anchor.sampleRate, re-encode in anchor codec.
                //   • transcode-to-Opus: anchor mode unavailable → existing
                //     Opus 48kHz path (subject to long-clip failure).
                const useAnchoredPassthrough =
                    audioSource &&
                    audioStrategy.kind === "anchored" &&
                    audioStrategy.clipMatches[ci];
                if (useAnchoredPassthrough && audioStrategy.kind === "anchored") {
                    const target = audioStrategy.target;
                    log(`${clipLabel} — audio passthrough (${target.codec} ${target.sampleRate} Hz)`);
                    const audioInput = new Input({
                        source: new BlobSource(clip.file),
                        formats: ALL_FORMATS,
                    });
                    let packetsAdded = 0;
                    // Start at the later of the video cursor and the actual
                    // end of the previous clip's audio — prevents GOP errors
                    // when Opus padding pushed the last packet slightly past
                    // timeOffset.
                    const passthroughAudioBase = Math.max(timeOffset, audioClipOutputTs);
                    let lastPacketEnd = passthroughAudioBase;
                    try {
                        const audioTrack = await audioInput.getPrimaryAudioTrack();
                        if (!audioTrack) {
                            log(`${clipLabel} — no audio track found (skipping)`);
                        } else {
                            const packetSink = new EncodedPacketSink(audioTrack);
                            const startPacket = await packetSink.getPacket(clip.start);
                            if (!startPacket) {
                                log(`${clipLabel} — no audio packet at clip start, skipping`);
                            } else {
                                try {
                                    for await (const pkt of packetSink.packets(startPacket)) {
                                        if (pkt.timestamp >= clip.end) break;
                                        const outputTs = passthroughAudioBase + Math.max(0, pkt.timestamp - clip.start);
                                        // Copy bytes; mediabunny may reuse the source packet's buffer.
                                        const adjusted = new EncodedPacket(
                                            new Uint8Array(pkt.data),
                                            pkt.type,
                                            outputTs,
                                            pkt.duration,
                                        );
                                        const meta = !audioMetaSent
                                            ? { decoderConfig: target.decoderConfig }
                                            : undefined;
                                        await audioSource.add(adjusted, meta);
                                        if (meta) audioMetaSent = true;
                                        packetsAdded++;
                                        lastPacketEnd = outputTs + pkt.duration;
                                    }
                                } catch (e) {
                                    log(
                                        `!! audio passthrough failed after ${packetsAdded} packets ` +
                                        `(lastEnd=${lastPacketEnd.toFixed(3)}s): ${(e as Error).message}`,
                                    );
                                    throw e;
                                }
                                log(
                                    `${clipLabel} — audio passthrough done: ${packetsAdded} packets, ` +
                                    `output ends at ${lastPacketEnd.toFixed(3)}s`,
                                );
                            }
                        }
                    } finally {
                        audioInput.dispose();
                    }
                    audioClipOutputTs = lastPacketEnd;
                } else if (audioSource) {
                    // Determine encoder target. In "anchored" mode mismatched
                    // clips are re-encoded into the anchor's codec/rate so the
                    // muxer sees a consistent stream. In fallback "transcode"
                    // mode we encode everything as Opus 48 kHz stereo.
                    const encoderConfig =
                        audioStrategy.kind === "anchored"
                            ? {
                                  codec: audioStrategy.target.decoderConfig.codec,
                                  sampleRate: audioStrategy.target.sampleRate,
                                  numberOfChannels: audioStrategy.target.numberOfChannels,
                                  bitrate: 128_000,
                              }
                            : {
                                  codec: "opus",
                                  sampleRate: 48_000,
                                  numberOfChannels: 2,
                                  bitrate: 128_000,
                              };
                    log(
                        `${clipLabel} — audio transcode to ${encoderConfig.codec} ${encoderConfig.sampleRate} Hz ${encoderConfig.numberOfChannels}ch`,
                    );

                    const CHUNK_SECS = 30;
                    const RESET_DECODER_EVERY = 10; // chunks (~300 s) between resets
                    let chunk: AudioSample[] = [];
                    let chunkDuration = 0;
                    // Start after any audio the previous clip already committed.
                    let audioOutputTs = Math.max(timeOffset, audioClipOutputTs);
                    let totalPackets = 0;
                    let chunksProcessed = 0;
                    let chunksSinceReset = 0;
                    let segmentCursor = clip.start; // next source-file position to decode
                    let audioMissing = false;

                    const flushChunk = async () => {
                                if (chunk.length === 0) return;
                                const tR = performance.now();

                                // Swap out the chunk immediately so any error in resampleAudio
                                // or the encoder doesn't leave the samples dangling (GC warning).
                                const toEncode = chunk;
                                chunk = [];
                                chunkDuration = 0;

                                const stageLabel = `chunk ${chunksProcessed + 1}`;

                                let resampled: AudioBuffer;
                                try {
                                    resampled = await resampleAudio(
                                        toEncode,
                                        encoderConfig.sampleRate,
                                        encoderConfig.numberOfChannels,
                                    );
                                } catch (e) {
                                    log(`!! ${stageLabel} resampleAudio failed: ${(e as Error).message}`);
                                    throw e;
                                } finally {
                                    for (const s of toEncode) s.close();
                                }

                                // AudioSamples with correct output-timeline timestamps.
                                const audioSamples = AudioSample.fromAudioBuffer(
                                    resampled!,
                                    audioOutputTs,
                                );

                                // Encode this chunk with a brand-new AudioEncoder so the
                                // encoder's internal state never grows beyond 30 s worth.
                                type CapturedPacket = {
                                    packet: EncodedPacket;
                                    meta: EncodedAudioChunkMetadata | undefined;
                                };
                                const captured: CapturedPacket[] = [];
                                let samplesClosed = false;
                                try {
                                    await new Promise<void>((resolve, reject) => {
                                        const enc = new AudioEncoder({
                                            output: (chunk, meta) => {
                                                captured.push({
                                                    packet: EncodedPacket.fromEncodedChunk(chunk),
                                                    meta: meta ?? undefined,
                                                });
                                            },
                                            error: (err) => {
                                                log(`!! ${stageLabel} AudioEncoder error callback fired: ${(err as Error).message}`);
                                                reject(err);
                                            },
                                        });
                                        try {
                                            enc.configure(encoderConfig);
                                            for (const s of audioSamples) {
                                                const ad = s.toAudioData();
                                                enc.encode(ad);
                                                ad.close();
                                                s.close();
                                            }
                                            samplesClosed = true;
                                            enc.flush().then(() => { enc.close(); resolve(); }).catch((err) => {
                                                log(`!! ${stageLabel} AudioEncoder.flush() rejected: ${(err as Error).message}`);
                                                reject(err);
                                            });
                                        } catch (err) {
                                            log(`!! ${stageLabel} AudioEncoder sync threw: ${(err as Error).message}`);
                                            try { enc.close(); } catch { /* ignore */ }
                                            reject(err);
                                        }
                                    });
                                } finally {
                                    if (!samplesClosed) {
                                        for (const s of audioSamples) {
                                            try { s.close(); } catch { /* ignore */ }
                                        }
                                    }
                                }

                                for (let i = 0; i < captured.length; i++) {
                                    const { packet, meta } = captured[i];
                                    const sendMeta = !audioMetaSent ? meta : undefined;
                                    try {
                                        await audioSource!.add(packet, sendMeta);
                                    } catch (e) {
                                        log(`!! ${stageLabel} audioSource.add failed at packet ${i}/${captured.length} (ts=${packet.timestamp.toFixed(3)}s): ${(e as Error).message}`);
                                        throw e;
                                    }
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

                    // Single Input lives for the entire audio pass. Only the
                    // lighter AudioSampleSink is recreated every N chunks.
                    const audioInput = new Input({
                        source: new BlobSource(clip.file),
                        formats: ALL_FORMATS,
                    });
                    try {
                        const audioTrack = await audioInput.getPrimaryAudioTrack();
                        if (!audioTrack) {
                            log(`${clipLabel} — no audio track found`);
                            audioMissing = true;
                        } else {
                            const nativeSampleRate = await audioTrack.getSampleRate();
                            const nativeChannels = await audioTrack.getNumberOfChannels();
                            log(
                                `${clipLabel} — decoding audio (native ${nativeSampleRate} Hz, ${nativeChannels} ch)`,
                            );

                            while (segmentCursor < clip.end) {
                                log(
                                    `${clipLabel} — fresh audio decoder, segment starts at ${segmentCursor.toFixed(2)}s`,
                                );

                                const audioSink = new AudioSampleSink(audioTrack);
                                chunksSinceReset = 0;
                                let resetRequested = false;

                                try {
                                    for await (const sample of audioSink.samples(
                                        segmentCursor,
                                        clip.end,
                                    )) {
                                        const cloned = sample.clone();
                                        sample.close();
                                        chunk.push(cloned);
                                        chunkDuration += cloned.duration;
                                        segmentCursor = cloned.timestamp + cloned.duration;
                                        totalPackets++;

                                        if (chunkDuration >= CHUNK_SECS) {
                                            await flushChunk();
                                            chunksSinceReset++;
                                            if (chunksSinceReset >= RESET_DECODER_EVERY) {
                                                resetRequested = true;
                                                break;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    log(
                                        `!! audioSink.samples failed at cursor ${segmentCursor.toFixed(2)}s` +
                                        ` (chunk ${chunksProcessed + 1}, after ${chunksSinceReset} segment chunks):` +
                                        ` ${(e as Error).message}`,
                                    );
                                    throw e;
                                }

                                if (!resetRequested) break; // generator drained naturally
                            }
                        }
                    } finally {
                        audioInput.dispose();
                    }

                    // Flush any final partial chunk.
                    await flushChunk();
                    audioClipOutputTs = audioOutputTs;

                    if (!audioMissing) {
                        log(`${clipLabel} — audio done (${totalPackets} packets, ${chunksProcessed} chunk(s))`);
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
                `finalize done — total ${((performance.now() - t0) / 1000).toFixed(2)}s,` +
                ` wrote ${(bytesWritten / 1_048_576).toFixed(1)} MiB`,
            );

            // Commit the file on disk. From this point the file is fully written.
            await fileWritable.close();
            fileWritable = null;

            setExportProgress(100);
            // Use the picked file name as the success marker (no Blob URL needed).
            setExportUrl(fileHandle.name);

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
            // Discard the partial file so the user doesn't end up with junk on disk.
            if (fileWritable) {
                try { await fileWritable.abort(); } catch { /* ignore */ }
                fileWritable = null;
            }
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
 * Probe every clip's primary audio track. If they all share the same codec,
 * sample rate, channel count, and decoder description bytes, return a
 * passthrough strategy so we can remux raw packets without ever touching a
 * WebCodecs AudioDecoder or AudioEncoder. Otherwise, return "transcode" and
 * the existing decode + Opus re-encode path is used.
 */
async function probeAudioStrategy(
    clips: Clip[],
    log: (msg: string) => void,
): Promise<
    | {
          kind: "anchored";
          target: {
              codec: AudioCodec;
              decoderConfig: AudioDecoderConfig;
              sampleRate: number;
              numberOfChannels: number;
          };
          clipMatches: boolean[];
      }
    | { kind: "transcode" }
> {
    type Probe = {
        codec: AudioCodec;
        sampleRate: number;
        numberOfChannels: number;
        decoderConfig: AudioDecoderConfig;
    };
    const probes: Probe[] = [];
    for (const clip of clips) {
        const probeInput = new Input({
            source: new BlobSource(clip.file),
            formats: ALL_FORMATS,
        });
        try {
            const track = await probeInput.getPrimaryAudioTrack();
            if (!track) {
                log(`probe: clip "${clip.name}" has no audio track → transcode-all`);
                return { kind: "transcode" };
            }
            const codec = await track.getCodec();
            const decoderConfig = await track.getDecoderConfig();
            if (!codec || !decoderConfig) {
                log(`probe: clip "${clip.name}" has no codec metadata → transcode-all`);
                return { kind: "transcode" };
            }
            probes.push({
                codec,
                sampleRate: await track.getSampleRate(),
                numberOfChannels: await track.getNumberOfChannels(),
                decoderConfig,
            });
        } finally {
            probeInput.dispose();
        }
    }

    // Anchor target = clip[0]'s config. For the typical long-recording use
    // case, clip 0 is the long one — making it the anchor means it gets the
    // passthrough fast path and the long-clip decode/encode failure is dodged.
    const anchor = probes[0];

    // Verify the browser can actually encode in the anchor codec, otherwise
    // mismatched clips couldn't be transcoded to match — bail to all-Opus.
    if (probes.some((p) => !configsMatch(p, anchor))) {
        const supported = await audioEncoderSupports(anchor);
        if (!supported) {
            log(
                `probe: clip 1 codec ${anchor.decoderConfig.codec} can't be encoded by this browser → transcode-all (Opus)`,
            );
            return { kind: "transcode" };
        }
    }

    const clipMatches = probes.map((p) => configsMatch(p, anchor));
    const mismatchCount = clipMatches.filter((m) => !m).length;
    if (mismatchCount === 0) {
        log(
            `probe: all clips compatible — passthrough audio (${anchor.codec}, ${anchor.sampleRate} Hz, ${anchor.numberOfChannels} ch)`,
        );
    } else {
        for (let i = 1; i < probes.length; i++) {
            if (!clipMatches[i]) {
                const p = probes[i];
                const why =
                    p.codec !== anchor.codec
                        ? `codec ${p.codec} vs anchor ${anchor.codec}`
                        : p.sampleRate !== anchor.sampleRate
                          ? `sampleRate ${p.sampleRate} vs anchor ${anchor.sampleRate}`
                          : p.numberOfChannels !== anchor.numberOfChannels
                            ? `channels ${p.numberOfChannels} vs anchor ${anchor.numberOfChannels}`
                            : "decoder description bytes differ";
                log(`probe: clip ${i + 1} differs (${why}) → will transcode to anchor`);
            }
        }
        log(
            `probe: anchored on clip 1 (${anchor.codec}, ${anchor.sampleRate} Hz, ${anchor.numberOfChannels} ch); ${probes.length - mismatchCount}/${probes.length} clips passthrough`,
        );
    }
    return {
        kind: "anchored",
        target: {
            codec: anchor.codec,
            decoderConfig: anchor.decoderConfig,
            sampleRate: anchor.sampleRate,
            numberOfChannels: anchor.numberOfChannels,
        },
        clipMatches,
    };
}

function configsMatch(
    a: { codec: AudioCodec; sampleRate: number; numberOfChannels: number; decoderConfig: AudioDecoderConfig },
    b: { codec: AudioCodec; sampleRate: number; numberOfChannels: number; decoderConfig: AudioDecoderConfig },
): boolean {
    return (
        a.codec === b.codec &&
        a.sampleRate === b.sampleRate &&
        a.numberOfChannels === b.numberOfChannels &&
        audioDescriptionsMatch(a.decoderConfig.description, b.decoderConfig.description)
    );
}

async function audioEncoderSupports(
    target: { decoderConfig: AudioDecoderConfig; sampleRate: number; numberOfChannels: number },
): Promise<boolean> {
    try {
        const result = await AudioEncoder.isConfigSupported({
            codec: target.decoderConfig.codec,
            sampleRate: target.sampleRate,
            numberOfChannels: target.numberOfChannels,
            bitrate: 128_000,
        });
        return !!result.supported;
    } catch {
        return false;
    }
}

function audioDescriptionsMatch(
    a: AllowSharedBufferSource | undefined,
    b: AllowSharedBufferSource | undefined,
): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const av = bytesOf(a);
    const bv = bytesOf(b);
    if (av.byteLength !== bv.byteLength) return false;
    for (let i = 0; i < av.byteLength; i++) if (av[i] !== bv[i]) return false;
    return true;
}

function bytesOf(src: AllowSharedBufferSource): Uint8Array {
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    // ArrayBufferView (incl. typed arrays) — these always have buffer/byteOffset
    // even when the underlying buffer is a SharedArrayBuffer.
    const view = src as ArrayBufferView;
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

/**
 * Merge raw AudioSamples from a clip and resample them to the target rate/channels
 * using OfflineAudioContext. Used to normalise differing source rates (44.1 vs 48 kHz)
 * before re-encoding so the encoder receives a consistent format across all clips.
 */
async function resampleAudio(
    samples: AudioSample[],
    targetRate: number,
    targetChannels: number,
): Promise<AudioBuffer> {
    const srcRate = samples[0].sampleRate;
    const srcCh = samples[0].numberOfChannels;
    const totalFrames = samples.reduce((n, s) => n + s.numberOfFrames, 0);

    // Merge into one AudioBuffer using the plain AudioBuffer constructor — no
    // OfflineAudioContext needed when the rate already matches the target.
    // Creating an OfflineAudioContext and then returning early was leaking an
    // 11 MB AudioBuffer per chunk (21 chunks = 231 MB) which caused OOM.
    const merge = (outCh: number, outRate: number, outFrames: number) => {
        const buf = new AudioBuffer({
            numberOfChannels: outCh,
            length: Math.max(1, outFrames),
            sampleRate: outRate,
        });
        let offset = 0;
        for (const sample of samples) {
            const ab = sample.toAudioBuffer();
            for (let ch = 0; ch < outCh; ch++) {
                buf.getChannelData(ch).set(
                    ab.getChannelData(Math.min(ch, ab.numberOfChannels - 1)),
                    offset,
                );
            }
            offset += sample.numberOfFrames;
        }
        return buf;
    };

    if (srcRate === targetRate && srcCh === targetChannels) {
        return merge(targetChannels, targetRate, totalFrames);
    }

    // Resample + remix via OfflineAudioContext (only when rate/channels differ).
    const merged = merge(srcCh, srcRate, totalFrames);
    const targetFrames = Math.ceil((totalFrames * targetRate) / srcRate);
    const resCtx = new OfflineAudioContext(targetChannels, Math.max(1, targetFrames), targetRate);
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
