"use client";

import {
    Circle,
    Film,
    Layers,
    Minus,
    Scissors,
    Shapes,
    Square,
    Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OverlayType } from "../types";

type Props = {
    hasClips: boolean;
    onSplitAtPlayhead: () => void;
    onAddOverlay: (type: OverlayType) => void;
};

const ToolsSidebar = ({ hasClips, onSplitAtPlayhead, onAddOverlay }: Props) => (
    <aside className="flex w-16 flex-col items-center gap-4 border-r border-white/5 bg-[#0f1216] py-6 text-slate-400">
        <Button
            variant="ghost"
            size="icon"
            className="text-slate-300 hover:text-white"
            title="Split at playhead"
            onClick={onSplitAtPlayhead}
            disabled={!hasClips}
        >
            <Scissors className="size-4" />
        </Button>
        <Button
            variant="ghost"
            size="icon"
            className="text-slate-300 hover:text-white"
            title="Add text"
            onClick={() => onAddOverlay("text")}
        >
            <Type className="size-4" />
        </Button>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
            <Shapes className="size-4 text-slate-400" />
            <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white"
                title="Rectangle"
                onClick={() => onAddOverlay("rect")}
            >
                <Square className="size-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white"
                title="Circle"
                onClick={() => onAddOverlay("circle")}
            >
                <Circle className="size-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white"
                title="Line"
                onClick={() => onAddOverlay("line")}
            >
                <Minus className="size-3.5" />
            </Button>
        </div>
    </aside>
);

export default ToolsSidebar;
