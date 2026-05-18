"use client";

import { List } from "react-movable";
import type { Overlay } from "../types";

type Props = {
    overlays: Overlay[];
    selectedOverlayId: string | null;
    onSelect: (id: string) => void;
    onReorder: (oldIndex: number, newIndex: number) => void;
};

const OverlaysList = ({ overlays, selectedOverlayId, onSelect, onReorder }: Props) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between">
            <p className="font-heading text-sm font-semibold text-white">Overlays</p>
            <span className="text-xs text-slate-500">{overlays.length} items</span>
        </div>
        <div className="space-y-2 rounded-xl border border-white/5 bg-[#0c0f14] p-2">
            <List
                values={overlays}
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
                        className={`rounded-lg border px-3 py-2 text-xs transition ${
                            isDragged
                                ? "border-pink-300/60 bg-pink-300/10"
                                : value.id === selectedOverlayId
                                  ? "border-pink-300/40 bg-pink-300/5"
                                  : "border-white/10 bg-[#121821]"
                        }`}
                        onClick={() => onSelect(value.id)}
                    >
                        <p className="font-medium capitalize text-white">{value.type}</p>
                        <p className="text-[0.7rem] text-slate-500">
                            {value.startTime.toFixed(1)}s – {value.endTime.toFixed(1)}s
                        </p>
                    </div>
                )}
            />
        </div>
    </div>
);

export default OverlaysList;
