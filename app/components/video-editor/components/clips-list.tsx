"use client";

import * as React from "react";
import { List } from "react-movable";
import { Trash2 } from "lucide-react";
import type { Clip } from "../types";

function ClipThumbnail({ clip }: { clip: Clip }) {
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const handleMetadata = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = clip.start + (clip.end - clip.start) * 0.1;
        }
    };
    return (
        <video
            ref={videoRef}
            src={clip.url}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={handleMetadata}
            className="h-full w-full object-cover"
        />
    );
}

type Props = {
    clips: Clip[];
    selectedClipId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onReorder: (oldIndex: number, newIndex: number) => void;
};

const ClipsList = ({ clips, selectedClipId, onSelect, onDelete, onReorder }: Props) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between">
            <p className="font-heading text-sm font-semibold text-white">Clips</p>
            <span className="text-xs text-slate-500">{clips.length} items</span>
        </div>
        <div className="space-y-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
            <List
                values={clips}
                onChange={({ oldIndex, newIndex }) => onReorder(oldIndex, newIndex)}
                renderList={({ children, props }) => (
                    <div {...props} className="space-y-2">
                        {children}
                    </div>
                )}
                renderItem={({ value, props: { key, ...itemProps }, isDragged }) => (
                    <div
                        key={key}
                        {...itemProps}
                        className={`group relative overflow-hidden rounded-xl border transition ${
                            isDragged
                                ? "border-emerald-400/60 bg-emerald-400/10"
                                : value.id === selectedClipId
                                  ? "border-emerald-400/40"
                                  : "border-white/10"
                        }`}
                        onClick={() => onSelect(value.id)}
                    >
                        {/* Video thumbnail */}
                        <div className="h-[72px] w-full bg-black">
                            <ClipThumbnail clip={value} />
                        </div>

                        {/* Overlay info bar */}
                        <div className="flex items-center justify-between bg-black/60 px-2 py-1">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[0.7rem] font-medium text-white">
                                    {value.name}
                                </p>
                                <p className="text-[0.6rem] text-slate-400">
                                    {Math.max(0, value.end - value.start).toFixed(2)}s
                                </p>
                            </div>
                            <button
                                type="button"
                                className="ml-2 shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(value.id);
                                }}
                                title="Delete clip"
                            >
                                <Trash2 className="size-3" />
                            </button>
                        </div>
                    </div>
                )}
            />
        </div>
    </div>
);

export default ClipsList;
