"use client";

import { Input } from "@/components/ui/input";
import type { Overlay } from "../types";

type Props = {
    overlay: Overlay;
    onUpdate: (patch: Partial<Overlay>) => void;
};

const OverlaySettings = ({ overlay, onUpdate }: Props) => (
    <div className="space-y-2 rounded-2xl border border-white/5 bg-[#0c0f14] p-3">
        <p className="text-xs uppercase tracking-[0.26em] text-slate-500">
            Overlay settings
        </p>

        {overlay.type === "text" && (
            <div className="grid gap-2">
                <label className="text-xs text-slate-500">Text</label>
                <Input
                    value={overlay.text}
                    onChange={(e) => onUpdate({ text: e.target.value })}
                    className="bg-[#0b0d10]"
                />
            </div>
        )}

        <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
                <label className="text-xs text-slate-500">Start</label>
                <Input
                    value={String(overlay.startTime)}
                    onChange={(e) =>
                        onUpdate({ startTime: Number.parseFloat(e.target.value) || 0 })
                    }
                    className="bg-[#0b0d10]"
                />
            </div>
            <div className="space-y-1">
                <label className="text-xs text-slate-500">End</label>
                <Input
                    value={String(overlay.endTime)}
                    onChange={(e) =>
                        onUpdate({ endTime: Number.parseFloat(e.target.value) || 0 })
                    }
                    className="bg-[#0b0d10]"
                />
            </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">Fill</label>
                    <input
                        type="checkbox"
                        checked={overlay.fillEnabled}
                        onChange={(e) => onUpdate({ fillEnabled: e.target.checked })}
                        className="accent-emerald-400"
                    />
                </div>
                <Input
                    type="color"
                    value={overlay.color}
                    disabled={!overlay.fillEnabled}
                    onChange={(e) => onUpdate({ color: e.target.value })}
                    className={overlay.fillEnabled ? "" : "opacity-40"}
                />
            </div>
            <div className="space-y-1">
                <label className="text-xs text-slate-500">Stroke color</label>
                <Input
                    type="color"
                    value={overlay.strokeColor}
                    onChange={(e) => onUpdate({ strokeColor: e.target.value })}
                />
            </div>
        </div>

        <div className="space-y-1">
            <label className="text-xs text-slate-500">Stroke width</label>
            <Input
                type="number"
                min={0}
                max={20}
                value={overlay.strokeWidth}
                onChange={(e) =>
                    onUpdate({ strokeWidth: Math.max(0, Number(e.target.value)) || 0 })
                }
                className="bg-[#0b0d10]"
            />
        </div>
    </div>
);

export default OverlaySettings;
