"use client";

import * as React from "react";
import { List, arrayMove } from "react-movable";
import { Download, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "../utils";
import type { Clip, Overlay, ExportResolution } from "../types";

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
    onSplitAtPlayhead: () => void;
    onTimelineSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResolutionChange: (r: ExportResolution) => void;
};

const RESOLUTIONS: ExportResolution[] = ["source", "720p", "1080p"];
const TICKS = Array.from({ length: 9 }, (_, i) => i);

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
    onSplitAtPlayhead,
    onTimelineSeek,
    onZoomIn,
    onZoomOut,
    onResolutionChange,
}: Props) => (
    <section className="border-t border-white/5 bg-[#0f1216] p-4">
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
                {/* Label column */}
                <div className="w-24 shrink-0 space-y-3 text-xs text-slate-400">
                    <div className="flex h-5 items-center text-slate-500">Time</div>
                    <div className="flex h-10 items-center">Video</div>
                    <div className="flex h-8 items-center">Overlays</div>
                </div>

                {/* Scrollable track area */}
                <div className="relative min-w-0 flex-1 overflow-x-auto">
                    <div
                        style={{ minWidth: `${timelineZoom * 100}%` }}
                        className="relative"
                    >
                        {/* Time ticks */}
                        <div className="mb-3 flex h-5 items-center gap-2 text-[0.65rem] text-slate-500">
                            {TICKS.map((tick) => (
                                <div key={tick} className="flex-1">
                                    <div className="h-2 w-px bg-white/10" />
                                    {formatTime((totalDuration / 8) * tick)}
                                </div>
                            ))}
                        </div>

                        {/* Video track */}
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
                                            {isSelected && (
                                                <button
                                                    type="button"
                                                    className="shrink-0 rounded p-0.5 text-emerald-200 hover:bg-rose-500/30 hover:text-rose-300"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onClipDelete(value.id);
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
                            onClick={onTimelineSeek}
                        >
                            {overlays.map((overlay) => {
                                const dur =
                                    totalDuration ||
                                    Math.max(...overlays.map((o) => o.endTime), 1);
                                const w =
                                    ((overlay.endTime - overlay.startTime) / dur) * 100;
                                const l = (overlay.startTime / dur) * 100;
                                return (
                                    <button
                                        key={overlay.id}
                                        type="button"
                                        className={`absolute top-1 h-6 rounded-lg px-2 text-[0.6rem] font-semibold ${
                                            overlay.id === selectedOverlayId
                                                ? "bg-pink-400 text-slate-950"
                                                : "bg-pink-500/40 text-pink-100"
                                        }`}
                                        style={{ left: `${l}%`, width: `${w}%` }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onOverlaySelect(overlay.id);
                                        }}
                                    >
                                        {overlay.type}
                                    </button>
                                );
                            })}
                        </div>

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

export default Timeline;
