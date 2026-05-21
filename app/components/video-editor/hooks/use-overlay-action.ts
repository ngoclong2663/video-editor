"use client";

import * as React from "react";
import type { Overlay, OverlayType } from "../types";

const createId = () => crypto.randomUUID();

export function useOverlayAction() {
    const [overlays, setOverlays] = React.useState<Overlay[]>([]);
    const [rawSelectedOverlayId, setSelectedOverlayId] = React.useState<string | null>(null);

    // Derive the active selection during render — avoids a setState-in-effect cascade.
    const selectedOverlayId = React.useMemo(() => {
        if (rawSelectedOverlayId && overlays.some((o) => o.id === rawSelectedOverlayId)) {
            return rawSelectedOverlayId;
        }
        return overlays[0]?.id ?? null;
    }, [rawSelectedOverlayId, overlays]);

    const selectedOverlay = React.useMemo(
        () => overlays.find((o) => o.id === selectedOverlayId) ?? null,
        [overlays, selectedOverlayId],
    );

    // totalDuration and timelineTime are passed as arguments to avoid hook dependencies
    const addOverlay = React.useCallback((type: OverlayType, totalDuration: number, timelineTime: number = 0) => {
        const endTime = totalDuration > 0
            ? Math.min(timelineTime + 10, totalDuration)
            : timelineTime + 10;
        const overlay: Overlay = {
            id: createId(),
            type,
            text: type === "text" ? "New text" : "",
            x: 80,
            y: 80,
            width: type === "circle" ? 120 : 180,
            height: type === "circle" ? 120 : 90,
            color: "#f97316",
            fillEnabled: type === "text",
            strokeColor: "#f97316",
            strokeWidth: type === "text" ? 0 : 3,
            fontSize: 28,
            startTime: timelineTime,
            endTime: Math.max(endTime, timelineTime + 1),
        };
        setOverlays((prev) => [...prev, overlay]);
        setSelectedOverlayId(overlay.id);
    }, []);

    const updateOverlay = React.useCallback(
        (id: string, patch: Partial<Overlay>) => {
            setOverlays((prev) =>
                prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
            );
        },
        [],
    );

    const updateOverlayPosition = React.useCallback(
        (id: string, x: number, y: number) => {
            setOverlays((prev) =>
                prev.map((o) => (o.id === id ? { ...o, x, y } : o)),
            );
        },
        [],
    );

    const updateOverlayGeometry = React.useCallback(
        (id: string, x: number, y: number, width: number, height: number) => {
            setOverlays((prev) =>
                prev.map((o) => (o.id === id ? { ...o, x, y, width, height } : o)),
            );
        },
        [],
    );

    return {
        overlays,
        setOverlays,
        selectedOverlay,
        selectedOverlayId,
        setSelectedOverlayId,
        addOverlay,
        updateOverlay,
        updateOverlayPosition,
        updateOverlayGeometry,
    };
}
