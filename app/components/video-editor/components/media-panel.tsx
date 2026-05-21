"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClipsList from "./clips-list";
import OverlaysList from "./overlays-list";
import OverlaySettings from "./overlay-settings";
import type { Clip, Overlay } from "../types";

type Props = {
    clips: Clip[];
    overlays: Overlay[];
    selectedClipId: string | null;
    selectedOverlay: Overlay | null;
    selectedOverlayId: string | null;
    onUploadBase: (files: File[]) => void;
    onAddClips: (files: File[]) => void;
    onClipSelect: (id: string) => void;
    onClipDelete: (id: string) => void;
    onClipsReorder: (oldIndex: number, newIndex: number) => void;
    onOverlaySelect: (id: string) => void;
    onOverlaysReorder: (oldIndex: number, newIndex: number) => void;
    onOverlayUpdate: (patch: Partial<Overlay>) => void;
};

const MediaPanel = ({
    clips,
    overlays,
    selectedClipId,
    selectedOverlay,
    selectedOverlayId,
    onUploadBase,
    onAddClips,
    onClipSelect,
    onClipDelete,
    onClipsReorder,
    onOverlaySelect,
    onOverlaysReorder,
    onOverlayUpdate,
}: Props) => {
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleFiles = (files: File[]) => {
        if (files.length === 0) return;
        if (clips.length === 0) onUploadBase(files);
        else onAddClips(files);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter((f) =>
            f.type.startsWith("video/"),
        );
        handleFiles(files);
    };

    return (
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

            {/* Single upload zone */}
            <button
                type="button"
                className="rounded-2xl border border-dashed border-white/10 bg-[#0c0f14] p-4 text-center transition hover:border-emerald-400/40 hover:bg-emerald-400/5"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                <Upload className="mx-auto size-5 text-emerald-300" />
                <p className="mt-2 text-sm font-medium text-white">Upload media files</p>
                <p className="text-xs text-slate-500">Click to browse or drop files here</p>
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
            />

            <ClipsList
                clips={clips}
                selectedClipId={selectedClipId}
                onSelect={onClipSelect}
                onDelete={onClipDelete}
                onReorder={onClipsReorder}
            />

            <OverlaysList
                overlays={overlays}
                selectedOverlayId={selectedOverlayId}
                onSelect={onOverlaySelect}
                onReorder={onOverlaysReorder}
            />

            {selectedOverlay && (
                <OverlaySettings
                    overlay={selectedOverlay}
                    onUpdate={onOverlayUpdate}
                />
            )}
        </aside>
    );
};

export default MediaPanel;
