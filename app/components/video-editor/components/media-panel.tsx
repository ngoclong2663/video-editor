"use client";

import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { arrayMove } from "react-movable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}: Props) => (
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
            <p className="mt-2 text-sm font-medium text-white">Upload media files</p>
            <p className="text-xs text-slate-500">Click to browse or drop files here</p>
            <div className="mt-3 grid gap-2">
                <Input
                    type="file"
                    accept="video/*"
                    onChange={(e) =>
                        onUploadBase(Array.from(e.target.files ?? []))
                    }
                    className="text-xs text-slate-200 file:text-slate-200"
                />
                <Input
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={(e) =>
                        onAddClips(Array.from(e.target.files ?? []))
                    }
                    className="text-xs text-slate-200 file:text-slate-200"
                />
            </div>
        </div>

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

export default MediaPanel;
