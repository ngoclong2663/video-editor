# Export Pipeline — `use-ffmpeg.ts`

Reference document for the `handleExport` implementation. Describes every design decision and known constraint so future debugging starts with full context.

---

## 1. High-level flow

```
handleExport()
 ├─ showSaveFilePicker()  (user gesture → FileSystemFileHandle)
 ├─ fileHandle.createWritable()  (FileSystemWritableFileStream)
 ├─ resolve output dimensions
 ├─ create VideoSampleSource  (AVC encoder)
 ├─ create EncodedAudioPacketSource  (Opus muxer input)
 ├─ create Output  (Mp4OutputFormat + StreamTarget → fileWritable.write)
 ├─ output.start()
 │
 ├─ for each clip:
 │   ├─ VIDEO PASS  (videoInput → CanvasSink → VideoSample → videoSource)
 │   └─ AUDIO PASS  (audioInput → AudioSampleSink → 30s chunks → fresh AudioEncoder → EncodedPacket → audioSource)
 │
 ├─ output.finalize()
 └─ fileWritable.close()  (file is now on disk)
```

---

## 2. Output resolution

- **Source**: uses `clips[0].width × clips[0].height` unchanged.
- **720p / 1080p**: `scaleDims()` fits the long axis to the target, short axis scales proportionally, both values rounded to nearest even number (AVC requirement).
- All output dimensions are forced even via `Math.round(n / 2) * 2`.

---

## 3. Output / muxing — `StreamTarget` + `writeOps[]`

**Why not `BufferTarget` or in-memory `StreamTarget`?**
`Mp4OutputFormat` uses non-monotonic writes — it seeks back to fix the `mdat` box size header after all media data is written. `AppendOnlyStreamTarget` rejects this outright. `BufferTarget` and any in-memory `StreamTarget` accumulator both have to hold the full encoded file in browser RAM; for an 18-minute 1080p clip at QUALITY_HIGH that's >1 GB, which OOMs the tab — the failure surfaces as a `TypeError: network error` from inside a WebCodecs allocation when the heap ceiling is hit.

**Current approach — stream directly to disk:**
```
window.showSaveFilePicker()              ← user gesture, picks destination
  → FileSystemFileHandle
  → fileHandle.createWritable({ keepExistingData: false })
  → FileSystemWritableFileStream

StreamTarget(WritableStream<{ type, data, position }>)
  → each write op forwarded directly via
       fileWritable.write({ type: 'write', position, data })
  chunked: true, chunkSize: 16 MB  ← reduces disk syscall count
```

The browser handles the disk seek transparently when `Mp4OutputFormat` writes the `mdat` size fixup — no in-memory overlap resolution needed. Peak memory stays near constant regardless of output length.

**On success:** `await fileWritable.close()` commits the file.
**On error:** `await fileWritable.abort()` discards the partial file so the user isn't left with junk on disk.

**Browser compatibility:**
File System Access API is Chromium-only at time of writing (Chrome, Edge, Brave, Opera). On unsupported browsers, the export sets `exportError` and bails early before any decoding starts.

---

## 4. Coordinate transform — `buildTransform()`

Overlays are positioned in **preview-canvas space** (pixel coordinates relative to the `<canvas>` element the user sees). The export must place them at the equivalent position in **video-pixel space**.

```
previewViewport  (e.g. 800 × 450px)
  └─ video is letterboxed inside it:
       renderedW × renderedH  at  (offsetX, offsetY)

video-pixel space  (outW × outH)
  └─ full frame, no letterbox

Transform functions (all in → out = integer pixels):
  vx(n) = round((n - offsetX) × (outW / renderedW))
  vy(n) = round((n - offsetY) × (outH / renderedH))
  vw(n) = round(n × (outW / renderedW))
  vh(n) = round(n × (outH / renderedH))
```

The letterbox geometry (`renderedW/H`, `offsetX/Y`) is recomputed from `clips[0]`'s aspect ratio vs the preview canvas aspect ratio. Clips with a different aspect ratio than clip 0 will have slightly misaligned overlays — acceptable edge case.

---

## 5. Video pass — per clip

```
videoInput  (BlobSource from clip.file)
  └─ CanvasSink(videoTrack, { width: outW, height: outH, fit: 'contain' })
       yields WrappedCanvas { canvas, timestamp (s), duration (s) }
```

**Two paths per frame, chosen by whether any overlay is active at `outputTs`:**

| Path | Condition | What happens |
|---|---|---|
| **Fast** | No active overlay | `new VideoSample(frame.canvas, { timestamp, duration })` — CanvasSink's GPU texture goes straight to `VideoSampleSource.add()`. No canvas blit, no explicit GPU readback. |
| **Slow** | ≥1 active overlay | `ctx.drawImage(frame.canvas)` + `renderOverlay()` on shared `offscreen` → `new VideoSample(offscreen, ...)`. One extra canvas blit + GPU readback for compositing. |

**Output timestamp:**
```
outputTs = timeOffset + max(0, frame.timestamp - clip.start)
```
`timeOffset` accumulates across clips (in seconds). `clip.start` offsets within the source file.

**Two dedicated `Input` instances per clip** (one for video, one for audio) prevent the single reader from seeking back and forth between tracks, which caused "network error" on long clips.

**`videoInput.dispose()`** is called in `finally` after every clip to free the decoder, demuxer, and file reader.

---

## 6. Audio pass — two strategies

Before the main pipeline starts, `probeAudioStrategy()` reads each clip's primary audio track and compares codec, sample rate, channel count, and decoder-config description bytes. Two strategies result:

### 6A. Passthrough (preferred path)

When all clips share identical audio configs:
```
EncodedPacketSink(audioTrack)
  → for each packet [clip.start, clip.end):
       outputTs = timeOffset + max(0, pkt.timestamp - clip.start)
       new EncodedPacket(copy(pkt.data), pkt.type, outputTs, pkt.duration)
       audioSource.add(adjustedPacket, firstPacketEverSent ? { decoderConfig } : undefined)
```

No `AudioDecoder` or `AudioEncoder` is ever created — the original AAC (or whatever codec) bytes are re-multiplexed straight into the new MP4. This **completely avoids the `TypeError: network error` failure mode** that the decode/encode WebCodecs paths reliably hit at ~600-1000 s. Output audio is bit-identical to the source (no quality loss, no resampling artefacts).

The `EncodedAudioChunkMetadata.decoderConfig` is taken from `audioTrack.getDecoderConfig()` during the probe and sent with the very first packet of the very first clip.

### 6B. Transcode (fallback)

When clips disagree on codec/rate/channels/description, decode → resample → re-encode is used instead.

#### 6B.1 Decoding

`AudioSampleSink` yields `AudioSample` objects; each is immediately cloned and `.close()`-d — an un-closed sample retains ~8 KB of `AudioData` and a 1129-s clip would leak ~420 MB.

#### 6B.2 Chunked processing — why 30 s

Processing the full clip as one `AudioBuffer` (`duration × 48000 × 2ch × 4B`) is ~410 MB for 1129 s and OOMs the browser. 30-second chunks bound each `AudioBuffer` to ~11 MB.

#### 6B.3 `resampleTo48k(chunk)` — no OfflineAudioContext for native 48kHz

Uses `new AudioBuffer({...})` directly for the native-rate passthrough path, only constructing an `OfflineAudioContext` when actual resampling is needed. Previously the always-created context leaked 11 MB per chunk → cumulative OOM.

#### 6B.4 Fresh `AudioEncoder` per chunk

A single long-lived encoder reliably throws `TypeError: network error` after ~600-1000 s of Opus encoding. Workaround: spin up a brand-new `AudioEncoder`, encode one 30-s chunk, `flush()`, `close()`. State never accumulates past one chunk.

#### 6B.5 Decoder config metadata

Passed once with the very first encoded packet — `EncodedAudioChunkMetadata` from the first chunk's encoder output callback. The muxer writes the codec description box in the MP4 container from this.

#### 6B.6 `audioOutputTs` advancement — Opus frame alignment

After each chunk: `audioOutputTs = lastPacket.timestamp + lastPacket.duration`, **not** `+= resampled.duration`. Opus pads partial frames to 1024-sample boundaries, so the encoder's actual output extends past the raw chunk duration; using the raw duration would place the next chunk's first packet before the previous chunk's last packet (mxr rejects: *"timestamps cannot be smaller than the largest timestamp of the previous GOP"*).

#### 6B.7 Decoder lifetime — long-lived decoders also fail

Even when avoiding the encoder problem via 6B.4, the **input-side** `AudioSampleSink` accumulates state in its underlying `AudioDecoder` and throws the same `network error` at ~600-1000 s of decoding. Attempting to recycle decoders by recreating `Input + Sink` periodically made things worse — empirically more decoder instances triggers earlier failure (likely shares a browser resource pool with the encoder).

The transcode path is therefore inherently fragile for clips beyond ~10 minutes of audio. Passthrough (6A) sidesteps this entirely and should be used whenever possible.

---

## 7. Error handling — `flushChunk` resource cleanup

`flushChunk` closes resources in `finally` blocks to prevent GC warnings and memory leaks on error:

```
flushChunk():
  toEncode = chunk; chunk = []          ← swap before any await
  try:
    resampled = await resampleTo48k(toEncode)
  finally:
    for s in toEncode: s.close()        ← always closed, even if resample throws

  audioSamples = AudioSample.fromAudioBuffer(resampled, audioOutputTs)
  samplesClosed = false
  try:
    await new Promise (AudioEncoder lifecycle)
      → closes each audioSample inside enc.encode() loop
      → samplesClosed = true after loop
  finally:
    if !samplesClosed: close remaining audioSamples
```

---

## 8. Known issues / limitations

| Issue | Status |
|---|---|
| `TypeError: network error` at audio chunk ~21-33 (~600-1000 s) | **Resolved** for compatible-codec clips via audio passthrough (no decoder/encoder, just remux). When clips have heterogeneous audio configs the transcode fallback is still used and may hit this. |
| GC warning "AudioSample collected without close" | Mitigated by `finally` blocks closing samples on error in `flushChunk`. Doesn't occur on the passthrough path at all (no `AudioSample` objects ever created). |
| Mixed-aspect-ratio clips | Known limitation — overlay coordinate transform is built from `clips[0]` dimensions, so clips with a different aspect ratio than the first may render overlays slightly off. |
| Heterogeneous audio configs across clips | Forces the transcode path which has the known ~10-minute audio limit. Workaround: pre-process clips to a common audio config, or split exports. |
| Browser compatibility | File System Access API is Chromium-only (Chrome, Edge, Brave, Opera). Safari and Firefox users see an error message and the export is blocked. |
| Partial files on cancel | If the user aborts mid-export (closes the tab, hits an error), `fileWritable.abort()` is called from the catch path. Tab-close races may leave a zero-byte or partial file. |

---

## 9. Change history

Chronological record of every significant change made during this debugging session so a new conversation can resume with full context.

### v1 — Replace ffmpeg.wasm with mediabunny

**Problem:** Original implementation used `@ffmpeg/ffmpeg` (single-threaded WASM x264), which was extremely slow (~3 fps on 1080p) and required `SharedArrayBuffer` headers.

**Solution:** Replaced the entire export pipeline with mediabunny + WebCodecs:
- `CanvasSink` decodes video frames; `CanvasSource` feeds encoder
- `AudioSampleSink` + `AudioSampleSource` for audio decode/encode
- MP4 output via mediabunny `Output` + `BufferTarget`

### v2 — Fix audio encoder errors (AAC → Opus; fresh encoder per chunk)

**Problem 1:** `AudioSampleSource({ codec: "aac" })` threw "encoder configuration not supported". WebCodecs AAC *encoding* is not reliably supported across browsers.
**Fix:** Switched to `codec: "opus"`.

**Problem 2:** Single long-lived Opus `AudioEncoder` inside `AudioSampleSource` threw `TypeError: network error` after ~600-1000 s of audio. Root cause: Chrome's WebCodecs `AudioEncoder` accumulates internal state and hits a resource limit after tens of thousands of frames.
**Fix:** Replaced `AudioSampleSource` with `EncodedAudioPacketSource("opus")`. For each 30-second audio chunk, a brand-new `AudioEncoder` is created, used, flushed, and closed — state never accumulates past one chunk.

**Problem 3:** Each new encoder's Opus frame alignment (1024-sample boundaries) meant the last frame of chunk N extended past `resampled.duration`, so chunk N+1's first packet had a timestamp before chunk N's last packet → muxer rejected it.
**Fix:** Advance `audioOutputTs` via `lastPacket.timestamp + lastPacket.duration` (actual end of last encoded frame), not `+= resampled.duration`.

### v3 — Fix audio decoder errors (AudioSampleSink fails at ~600-1000 s)

**Problem:** After solving the encoder side, the *input-side* `AudioSampleSink` (which wraps a `WebCodecs AudioDecoder`) also threw `TypeError: network error` at ~600-1000 s of decoded audio. Confirmed via `!! audioSink.samples failed at cursor X.Xs` log line.

**Attempted mitigations (all failed to fully resolve):**
- Tried recycling `AudioSampleSink` every N chunks (fresh `AudioDecoder` per segment)
- Tried recycling both `Input` and `AudioSampleSink` every N chunks
- Creating more decoder instances made things *worse* (earlier failure), suggesting a shared browser resource pool is being exhausted

**Conclusion:** Long-clip audio decode/encode via WebCodecs is fundamentally unreliable in Chrome beyond ~10 minutes. The only robust solution is to avoid the audio codec path entirely.

### v4 — Fix OOM from in-memory write accumulation (BufferTarget → FSA streaming)

**Problem:** `BufferTarget` accumulated the full encoded output as a single `ArrayBuffer`. For 18-minute 1080p at QUALITY_HIGH, this exceeded ~1 GB and the browser threw `TypeError: network error` (OOM from heap pressure) while audio was still being encoded.

**Fix:** Switched to `StreamTarget` + `FileSystemWritableFileStream` (File System Access API):
- `window.showSaveFilePicker()` is called at export start (within the user-gesture window from the export button click)
- Each mediabunny `StreamTarget` write op is forwarded to `fileWritable.write({ type: 'write', position, data })`
- The file is written directly to disk with no in-memory accumulation
- `fileWritable.close()` on success, `fileWritable.abort()` on error

**Trade-off:** Export now requires Chrome/Edge/Brave/Opera (Chromium-only File System Access API). Safari and Firefox are blocked with an error message.

### v5 — Audio passthrough: skip decode/encode for matching clips

**Problem:** The `AudioSampleSink` decoder still failed at ~600 s on the long clip, even with the FSA streaming fix. The decoder failure is independent of memory — it's a Chrome WebCodecs codec resource limit.

**Observation:** If all clips share the same audio codec/sampleRate/channels/decoderConfig, the audio packets from the source can be remuxed directly into the output MP4 without any decoding or re-encoding. No `AudioDecoder` or `AudioEncoder` runs at all → failure mode is completely bypassed.

**Fix:** Added `probeAudioStrategy(clips)` pre-flight:
1. Reads each clip's audio track metadata (`getCodec()`, `getSampleRate()`, `getNumberOfChannels()`, `getDecoderConfig()`)
2. Picks **clip[0] as the anchor** (longest clip in typical use)
3. For clips matching the anchor: `EncodedPacketSink` reads raw packets → `EncodedAudioPacketSource.add()`. Zero codec involvement.
4. For clips not matching the anchor (different sample rate etc.): decode → `resampleAudio()` → re-encode in anchor's codec. Short clips are fine; only long mismatched clips would re-hit the limit.
5. If the anchor's codec cannot be encoded by the browser (`AudioEncoder.isConfigSupported` check), falls back to all-Opus transcode.

**Result for the tested 3-clip case:**
- Clip 1 (1.7 GB / 1129 s, AAC 48 kHz): **passthrough** — no WebCodecs audio codec runs
- Clip 2 (658 MB, AAC 48 kHz): **passthrough**
- Clip 3 (12 MB, AAC 44.1 kHz): **transcode-to-anchor** (decoded + resampled to 48 kHz + re-encoded as AAC). Short enough that decode/encode never hits the limit.

### v6 — Video path optimisation (CanvasSource → VideoSampleSource)

**Problem:** `CanvasSource.add()` was measuring `encode+readback ≈ 7-8 ms/frame`. For 33,841 frames this was a large fraction of the total video processing time.

**Root cause:** `CanvasSource` captures the canvas pixel state on every `add()` call, which requires a GPU→CPU readback followed by feeding raw pixels to `VideoEncoder`. For 1080p this is 1920×1080×4 B = 8 MB of GPU-CPU transfer per frame.

**Fix:** Replaced `CanvasSource` with `VideoSampleSource`. `CanvasSink` already decodes and resizes each frame as an `OffscreenCanvas` (GPU texture). The key change:
- **No active overlay on this frame:** wrap `frame.canvas` directly as `new VideoSample(frame.canvas, { timestamp, duration })` — the GPU texture travels straight to the encoder without a CPU roundtrip
- **Overlay active:** composite onto our own `OffscreenCanvas`, then `new VideoSample(offscreen, { timestamp, duration })`

**Result:** `encode+readback` dropped from ~8 ms to ~0.2 ms per frame (~40× improvement). For 33,841 frames that saves ~260 s of wall time.

### v8 — Cross-clip audio timestamp continuity (`audioClipOutputTs`)

**Problem:** On a 6-clip export, clip 3's audio failed at packet 0 with:
```
Timestamps cannot be smaller than the largest timestamp of the previous GOP.
Got 424.824399s, but largest timestamp is 425.093566s.
```
Clip 2's Opus transcode ended at 425.093 s due to accumulated frame-boundary padding (~21 ms/chunk × N chunks ≈ 269 ms overshoot). `timeOffset` (video-based) after clip 2 was only 424.824 s, so clip 3's audio started at `timeOffset` — before the muxer's last seen audio timestamp.

**Root cause:** `timeOffset` advances by the clip's *video* duration, which is exact. Opus encoding pads partial frames to 1024-sample boundaries, causing each clip's audio to end *slightly later* than `timeOffset`. The drift accumulates across clips.

**Fix:** Added `audioClipOutputTs` (initialised to 0 before the clip loop) to track the actual end of the last audio packet across clip boundaries.

- **Passthrough path:** `passthroughAudioBase = Math.max(timeOffset, audioClipOutputTs)`. All packet timestamps placed relative to this base. After the loop: `audioClipOutputTs = lastPacketEnd`.
- **Transcode path:** `audioOutputTs = Math.max(timeOffset, audioClipOutputTs)` at clip start. After `flushChunk()` drains: `audioClipOutputTs = audioOutputTs`.

Both paths ensure the next clip's audio never starts before the previous clip's last packet ended, regardless of Opus padding accumulation.

### v9 — Export loading overlay with cancel support

**Change:** Added a full-screen blocking overlay that appears during export.

- A fixed `z-50` overlay with `backdrop-blur-sm` covers the entire UI while `isExporting` is true, preventing any user interaction.
- Shows a `Progress` bar (shadcn/ui), "XX% complete" counter, and clip count.
- A "Cancel export" button calls `cancelExport()`, which sets `abortRef.current = true`.
- The export loop checks `abortRef.current` at three points: start of each clip, every 30 video frames, and before each audio chunk flush.
- On cancel, `ExportCancelledError` is thrown, caught silently (no error UI), and `fileWritable.abort()` discards the partial file. `setExportProgress(0)` resets the indicator.
- `cancelExport` is returned from `useFfmpeg` and wired to the overlay button in `index.tsx`.

### v7 — Audio chunk memory fixes

**Problem 1:** `resampleTo48k()` always created `new OfflineAudioContext(...)` before checking if resampling was needed, then returned early for native-48kHz audio. The context (and its 11 MB `AudioBuffer`) was never GC'd promptly → 21 chunks × 11 MB = 231 MB of leaked Web Audio memory → triggered the "network error" earlier.
**Fix:** For native-rate audio, use `new AudioBuffer({...})` directly (no context, no leak). Only create `OfflineAudioContext` when actual resampling is needed. Renamed function to `resampleAudio(samples, targetRate, targetChannels)`.

**Problem 2:** Generator-yielded `AudioSample` objects were cloned but the originals were never closed → ~420 MB of accumulated `AudioData` for 1129-s clip.
**Fix:** `sample.close()` immediately after `sample.clone()` in the decode loop.

**Problem 3:** If `resampleAudio()` threw, `chunk[]` items were leaked (close was after the await, not in finally).
**Fix:** `toEncode = chunk; chunk = []` before await; `finally { for s of toEncode: s.close() }`.

---

## 10. Mediabunny API notes (seconds everywhere)

All mediabunny timestamps and durations are in **seconds** (not microseconds). WebCodecs APIs (`AudioData.timestamp`, `EncodedAudioChunk.timestamp`) use **microseconds**. `EncodedPacket.fromEncodedChunk()` converts automatically.

| Object | Timestamp unit |
|---|---|
| `WrappedCanvas.timestamp` | seconds |
| `VideoSample.timestamp` / `VideoSampleInit.timestamp` | seconds |
| `AudioSample.timestamp` | seconds |
| `EncodedPacket.timestamp` / `.duration` | seconds |
| `WebCodecs AudioData.timestamp` | microseconds |
| `WebCodecs EncodedAudioChunk.timestamp` | microseconds |
