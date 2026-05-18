"use client";

import * as React from "react";

export function useTimelineAction() {
    const [timelineTime, setTimelineTime] = React.useState(0);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [timelineZoom, setTimelineZoom] = React.useState(1);

    const zoomIn = React.useCallback(() => {
        setTimelineZoom((z) => Math.min(8, +(z + 0.5).toFixed(1)));
    }, []);

    const zoomOut = React.useCallback(() => {
        setTimelineZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)));
    }, []);

    return {
        timelineTime,
        setTimelineTime,
        isPlaying,
        setIsPlaying,
        timelineZoom,
        zoomIn,
        zoomOut,
    };
}
