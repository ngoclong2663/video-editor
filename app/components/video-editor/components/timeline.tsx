"use client";

import * as React from "react";
import { List } from "react-movable";
import { arrayMove } from "react-movable";
import { Download, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "../utils";
import type { Clip, Overlay, ExportResolution } from "../types";

type OverlayDrag = {
    overlayId: string;
    /** "timing" = left/right drag changes startTime/endTime; "reorder" = vertical drag changes lane */
    mode: "timing" | "reorder";
    timingMode: "move" | "resize-start" | "resize-end";
    startX: number;
    startY: number;
    /** Index in the overlays array at drag start */
    originalIndex: number;
    /** Current reorder target lane (updated live during reorder drag) */
    targetIndex: number;
    originalStart: number;
    originalEnd: number;
    /** scrollWidth of the track container at drag start — used as px scale */
    scrollWidth: number;
    dur: number;
};

type Props = {
    clips: Clip[];
    overlays: Overlay[];
    selectedClipId: string | null;
    selectedOverlayId: string | null;
    timelineTime: number;
    totalDuration: number;
    timelineZoom: number;
    exportResolution: ExportResolution;
    exportUrl: string | null;
    exportError: string | null;
    onClipSelect: (id: string) => void;
    onClipDelete: (id: string) => void;
    onClipsReorder: (oldIndex: number, newIndex: number) => void;
    onOverlaySelect: (id: string) => void;
    onOverlayMove: (id: string, startTime: number, endTime: number) => void;
    onOverlayReorder: (oldIndex: number, newIndex: number) => void;
    onSplitAtPlayhead: () => void;
    onTimelineSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResolutionChange: (r: ExportResolution) => void;
};

const RESOLUTIONS: ExportResolution[] = ["source", "720p", "1080p"];
const TICKS = Array.from({ length: 9 }, (_, i) => i);
const LANE_H = 28; // px — must match h-7 (Tailwind)

const Timeline = ({
    clips,
    overlays,
    selectedClipId,
    selectedOverlayId,
    timelineTime,
    totalDuration,
    timelineZoom,
    exportResolution,
    exportUrl,
    exportError,
    onClipSelect,
    onClipDelete,
    onClipsReorder,
    onOverlaySelect,
    onOverlayMove,
    onOverlayReorder,
    onSplitAtPlayhead,
    onTimelineSeek,
    onZoomIn,
    onZoomOut,
    onResolutionChange,
}: Props) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [drag, setDrag] = React.useState<OverlayDrag | null>(null);

    // Derive the visual overlay order during a reorder drag for live feedback
    const displayedOverlays = React.useMemo(() => {
        if (!drag || drag.mode !== "reorder") return overlays;
        return arrayMove([...overlays], drag.originalIndex, drag.targetIndex);
    }, [overlays, drag]);

    // ── Section-level mouse handlers (drag + auto-scroll) ────────────────────

    const handleSectionMouseMove = React.useCallback(
        (e: React.MouseEvent) => {
            // Auto-scroll: scroll the track area when holding left button near edges
            if (e.buttons === 1 && scrollRef.current) {
                const el = scrollRef.current;
                const rect = el.getBoundingClientRect();
                const T = 80; // threshold px
                const dRight = rect.right - e.clientX;
                const dLeft = e.clientX - rect.left;
                if (dRight > 0 && dRight < T)
                    el.scrollLeft += ((T - dRight) / T) * 14;
                else if (dLeft > 0 && dLeft < T)
                    el.scrollLeft -= ((T - dLeft) / T) * 10;
            }

            if (!drag) return;

            const { overlayId, mode, timingMode, startX, startY, originalIndex,
                    originalStart, originalEnd, scrollWidth, dur } = drag;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Promote to reorder if vertical movement dominates and exceeds threshold
            if (
                mode === "timing" &&
                Math.abs(deltaY) > 14 &&
                Math.abs(deltaY) > Math.abs(deltaX) * 1.5
            ) {
                setDrag((prev) => prev ? { ...prev, mode: "reorder" } : null);
                return;
            }

            if (mode === "timing" && scrollWidth > 0 && dur > 0) {
                const pxPerSec = scrollWidth / dur;
                const dt = deltaX / pxPerSec;
                const spanDur = originalEnd - originalStart;
                let ns = originalStart;
                let ne = originalEnd;

                if (timingMode === "move") {
                    ns = Math.max(0, Math.min(originalStart + dt, dur - spanDur));
                    ne = ns + spanDur;
                } else if (timingMode === "resize-start") {
                    ns = Math.max(0, Math.min(originalStart + dt, originalEnd - 0.1));
                } else {
                    ne = Math.min(dur, Math.max(originalEnd + dt, originalStart + 0.1));
                }

                onOverlayMove(overlayId, ns, ne);
            }

            if (mode === "reorder") {
                const newTarget = Math.max(
                    0,
                    Math.min(
                        Math.round(originalIndex + deltaY / LANE_H),
                        overlays.length - 1,
                    ),
                );
                if (newTarget !== drag.targetIndex) {
                    setDrag((prev) => prev ? { ...prev, targetIndex: newTarget } : null);
                }
            }
        },
        [drag, overlays.length, onOverlayMove],
    );

    const handleSectionMouseUp = React.useCallback(() => {
        if (!drag) return;
        if (drag.mode === "reorder" && drag.targetIndex !== drag.originalIndex) {
            onOverlayReorder(drag.originalIndex, drag.targetIndex);
        }
        setDrag(null);
    }, [drag, onOverlayReorder]);

    // ── Overlay block mouse-down ──────────────────────────────────────────────

    const startOverlayDrag = React.useCallback(
        (
            e: React.MouseEvent,
            overlay: Overlay,
            laneIndex: number,
            timingMode: "move" | "resize-start" | "resize-end",
        ) => {
            e.stopPropagation();
            e.preventDefault();
            onOverlaySelect(overlay.id);
            setDrag({
                overlayId: overlay.id,
                mode: "timing",
                timingMode,
                startX: e.clientX,
                startY: e.clientY,
                originalIndex: laneIndex,
                targetIndex: laneIndex,
                originalStart: overlay.startTime,
                originalEnd: overlay.endTime,
                scrollWidth: scrollRef.current?.scrollWidth ?? 1,
                dur: totalDuration || 1,
            });
        },
        [onOverlaySelect, totalDuration],
    );

    // ── Derived values ────────────────────────────────────────────────────────

    const overlayDur = React.useMemo(
        () => totalDuration || Math.max(...overlays.map((o) => o.endTime), 1),
        [totalDuration, overlays],
    );

    return (
        <section
            className="border-t border-white/5 bg-[#0f1216] p-4"
            onMouseMove={handleSectionMouseMove}
            onMouseUp={handleSectionMouseUp}
            // Ensure mouseup fires even if cursor drifts outside individual elements
            onMouseLeave={(e) => {
                if (e.buttons === 0) handleSectionMouseUp();
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <p className="font-heading text-sm font-semibold text-white">Timeline</p>
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="gap-2"
                        onClick={onSplitAtPlayhead}
                        disabled={clips.length === 0}
                    >
                        <Scissors className="size-4" />
                        Split at playhead
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-2 text-slate-400">
                        <Plus className="size-4" />
                        Add track
                    </Button>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0c0f14] px-2 py-1">
                        {RESOLUTIONS.map((r) => (
                            <Button
                                key={r}
                                size="sm"
                                variant={exportResolution === r ? "default" : "ghost"}
                                onClick={() => onResolutionChange(r)}
                            >
                                {r}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Tracks */}
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
                        onClick={onZoomOut}
                        disabled={timelineZoom <= 1}
                    >
                        <Minus className="size-3" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={onZoomIn}
                    >
                        <Plus className="size-3" />
                    </Button>
                </div>

                <div className="flex items-start gap-3">
                    {/* Label column — heights must stay in sync with track rows */}
                    <div className="w-20 shrink-0 select-none text-xs text-slate-400">
                        <div className="mb-3 flex h-5 items-center text-slate-500">Time</div>
                        <div className="mb-3 flex h-10 items-center">Video</div>
                        {displayedOverlays.length === 0 ? (
                            <div className="flex h-7 items-center">Overlays</div>
                        ) : (
                            <>
                                <div className="mb-0.5 flex h-5 items-center text-[0.6rem] uppercase tracking-widest text-slate-500">
                                    Overlays
                                </div>
                                {displayedOverlays.map((overlay) => (
                                    <div
                                        key={overlay.id}
                                        className={`mb-1 flex h-7 items-center truncate capitalize text-[0.65rem] ${
                                            drag?.overlayId === overlay.id && drag.mode === "reorder"
                                                ? "text-pink-300"
                                                : ""
                                        }`}
                                    >
                                        {overlay.type}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    {/* Scrollable track area */}
                    <div
                        ref={scrollRef}
                        className="relative min-w-0 flex-1 overflow-x-auto"
                    >
                        <div
                            style={{ minWidth: `${timelineZoom * 100}%` }}
                            className="relative"
                        >
                            {/* Time ticks — h-5 mb-3 */}
                            <div className="mb-3 flex h-5 items-center gap-2 text-[0.65rem] text-slate-500">
                                {TICKS.map((tick) => (
                                    <div key={tick} className="flex-1">
                                        <div className="h-2 w-px bg-white/10" />
                                        {formatTime((totalDuration / 8) * tick)}
                                    </div>
                                ))}
                            </div>

                            {/* Video track — h-10 mb-3 */}
                            <div className="mb-3">
                                <List
                                    values={clips}
                                    onChange={({ oldIndex, newIndex }) =>
                                        onClipsReorder(oldIndex, newIndex)
                                    }
                                    renderList={({ children, props }) => (
                                        <div
                                            {...props}
                                            className="flex h-10 overflow-hidden rounded-xl border border-white/5 bg-[#0c0f14]"
                                            onClick={onTimelineSeek}
                                        >
                                            {children}
                                        </div>
                                    )}
                                    renderItem={({
                                        value,
                                        props: { key, ...itemProps },
                                        isDragged,
                                    }) => {
                                        const clipLen = value.end - value.start;
                                        const w = totalDuration
                                            ? `${(clipLen / totalDuration) * 100}%`
                                            : "100%";
                                        const isSelected = value.id === selectedClipId;
                                        return (
                                            <div
                                                key={key}
                                                {...itemProps}
                                                style={{ ...itemProps.style, width: w }}
                                                className={`group relative flex shrink-0 items-center justify-center gap-1 overflow-hidden border-r border-white/5 px-2 text-[0.65rem] font-medium ${
                                                    isDragged
                                                        ? "cursor-grabbing bg-emerald-400/30 text-emerald-100"
                                                        : isSelected
                                                          ? "cursor-grab bg-emerald-400/20 text-emerald-100"
                                                          : "cursor-grab bg-emerald-400/10 text-emerald-200"
                                                }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onClipSelect(value.id);
                                                }}
                                            >
                                                <span className="truncate">{value.name}</span>
                                                {/* Delete shown on hover for every clip */}
                                                <button
                                                    type="button"
                                                    className="shrink-0 rounded p-0.5 text-emerald-200 opacity-0 transition hover:bg-rose-500/30 hover:text-rose-300 group-hover:opacity-100"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onClipDelete(value.id);
                                                    }}
                                                    title="Delete clip"
                                                >
                                                    <Trash2 className="size-3" />
                                                </button>
                                            </div>
                                        );
                                    }}
                                />
                            </div>

                            {/* Overlay lanes */}
                            {displayedOverlays.length === 0 ? (
                                <div
                                    className="h-7 cursor-pointer rounded-xl border border-white/5 bg-[#0c0f14]"
                                    onClick={onTimelineSeek}
                                />
                            ) : (
                                <>
                                    {/* Spacer matching "Overlays" header label (h-5 mb-0.5) */}
                                    <div className="mb-0.5 h-5" />

                                    {displayedOverlays.map((overlay, laneIndex) => {
                                        const w = Math.max(
                                            ((overlay.endTime - overlay.startTime) / overlayDur) * 100,
                                            1,
                                        );
                                        const l = (overlay.startTime / overlayDur) * 100;
                                        const isSelected = overlay.id === selectedOverlayId;
                                        const isBeingDragged = drag?.overlayId === overlay.id;

                                        return (
                                            <div
                                                key={overlay.id}
                                                className="relative mb-1 h-7 cursor-pointer rounded-lg border border-white/5 bg-[#0c0f14]"
                                                onClick={onTimelineSeek}
                                            >
                                                {/* Overlay block */}
                                                <div
                                                    className={`absolute top-0.5 flex h-6 select-none items-center rounded-lg text-[0.6rem] font-semibold transition-opacity ${
                                                        isSelected
                                                            ? "bg-pink-400 text-slate-950"
                                                            : "bg-pink-500/40 text-pink-100"
                                                    } ${isBeingDragged && drag?.mode === "reorder" ? "opacity-40" : ""}`}
                                                    style={{
                                                        left: `${l}%`,
                                                        width: `${w}%`,
                                                        minWidth: "24px",
                                                        cursor: drag?.mode === "reorder" ? "ns-resize" : "grab",
                                                    }}
                                                    onMouseDown={(e) =>
                                                        startOverlayDrag(e, overlay, laneIndex, "move")
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOverlaySelect(overlay.id);
                                                    }}
                                                >
                                                    {/* Left resize handle */}
                                                    <div
                                                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
                                                        onMouseDown={(e) => {
                                                            e.stopPropagation();
                                                            startOverlayDrag(e, overlay, laneIndex, "resize-start");
                                                        }}
                                                    />
                                                    <span className="flex-1 truncate px-2">{overlay.type}</span>
                                                    {/* Right resize handle */}
                                                    <div
                                                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                                                        onMouseDown={(e) => {
                                                            e.stopPropagation();
                                                            startOverlayDrag(e, overlay, laneIndex, "resize-end");
                                                        }}
                                                    />
                                                </div>

                                                {/* Drop indicator during reorder */}
                                                {drag?.mode === "reorder" &&
                                                    drag.targetIndex === laneIndex &&
                                                    drag.overlayId !== overlay.id && (
                                                        <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-pink-400/60" />
                                                    )}
                                            </div>
                                        );
                                    })}
                                </>
                            )}

                            {/* Playhead */}
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
                <p className="mt-3 text-xs text-rose-300">{exportError}</p>
            )}
        </section>
    );
};

export default Timeline;
