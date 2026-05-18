"use client";

import { Clapperboard, Download, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
    isExporting: boolean;
    exportProgress: number;
    hasClips: boolean;
    onExport: () => void;
};

const EditorHeader = ({
    isExporting,
    exportProgress,
    hasClips,
    onExport,
}: Props) => (
    <header className="flex items-center justify-between border-b border-white/5 bg-[#0f1216] px-6 py-4">
        <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-slate-200">
                <Menu className="size-4" />
            </Button>
            <div>
                <p className="text-xs uppercase tracking-[0.26em] text-slate-500">
                    Keyframes Studio
                </p>
                <h1 className="font-heading text-lg font-semibold text-white">
                    My Workspace // Demo Reel
                </h1>
            </div>
        </div>
        <div className="flex items-center gap-2">
            <Button
                className="gap-2"
                onClick={onExport}
                disabled={isExporting || !hasClips}
            >
                <Download className="size-4" />
                {isExporting ? `Exporting ${exportProgress}%` : "Export"}
            </Button>
        </div>
    </header>
);

export default EditorHeader;
