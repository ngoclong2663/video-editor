"use client";

import * as React from "react";
import type { Clip } from "../types";

const createId = () => crypto.randomUUID();

const probeFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    const result = await new Promise<{
        duration: number;
        hasAudio: boolean;
        width: number;
        height: number;
    }>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = url;
        video.onloadeddata = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = video as any;
            const hasAudio =
                v.mozHasAudio === true ||
                (v.audioTracks != null && v.audioTracks.length > 0) ||
                v.webkitAudioDecodedByteCount > 0;
            resolve({
                duration: video.duration || 0,
                hasAudio,
                width: video.videoWidth,
                height: video.videoHeight,
            });
        };
        video.onerror = () => reject(new Error("Failed to read video metadata"));
    });
    URL.revokeObjectURL(url);
    return result;
};

const createClipFromFile = async (file: File): Promise<Clip> => {
    const { duration, hasAudio, width, height } = await probeFile(file);
    return {
        id: createId(),
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        start: 0,
        end: duration,
        duration,
        hasAudio,
        width,
        height,
    };
};

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

export function useClipAction() {
    const [clips, setClips] = React.useState<Clip[]>([]);
    const [rawSelectedClipId, setSelectedClipId] = React.useState<string | null>(null);

    const totalDuration = React.useMemo(
        () => clips.reduce((total, clip) => total + (clip.end - clip.start), 0),
        [clips],
    );

    // Derive the active selection during render — avoids a setState-in-effect cascade.
    // Falls back to the first clip whenever the stored id is absent or no longer valid.
    const selectedClipId = React.useMemo(() => {
        if (rawSelectedClipId && clips.some((c) => c.id === rawSelectedClipId)) {
            return rawSelectedClipId;
        }
        return clips[0]?.id ?? null;
    }, [rawSelectedClipId, clips]);

    const findClipAtTimelineTime = React.useCallback(
        (time: number) => {
            let cursor = 0;
            for (let index = 0; index < clips.length; index += 1) {
                const clip = clips[index];
                const length = clip.end - clip.start;
                if (time <= cursor + length || index === clips.length - 1) {
                    return {
                        clip,
                        index,
                        clipStart: cursor,
                        localOffset: Math.max(0, time - cursor),
                    };
                }
                cursor += length;
            }
            return null;
        },
        [clips],
    );

    const splitAtTime = React.useCallback(
        (time: number) => {
            const target = findClipAtTimelineTime(time);
            if (!target) return;

            const splitPoint = clamp(
                target.clip.start + target.localOffset,
                target.clip.start + 0.1,
                target.clip.end - 0.1,
            );

            const left: Clip = { ...target.clip, id: createId(), end: splitPoint };
            const right: Clip = { ...target.clip, id: createId(), start: splitPoint };

            setClips((prev) => {
                const next = [...prev];
                next.splice(target.index, 1, left, right);
                return next;
            });
            setSelectedClipId(left.id);
        },
        [findClipAtTimelineTime],
    );

    // timelineTime is passed as an argument to avoid needing it as a hook dependency
    const splitAtPlayhead = React.useCallback(
        (timelineTime: number) => {
            if (totalDuration === 0) return;
            splitAtTime(timelineTime);
        },
        [splitAtTime, totalDuration],
    );

    const deleteClip = React.useCallback((id: string) => {
        setClips((prev) => prev.filter((c) => c.id !== id));
        setSelectedClipId((prev) => (prev === id ? null : prev));
    }, []);

    const uploadBaseVideo = React.useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        const prepared = await Promise.all(files.map(createClipFromFile));
        setClips(prepared);
        setSelectedClipId(null);
    }, []);

    const addClips = React.useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        const prepared = await Promise.all(files.map(createClipFromFile));
        setClips((prev) => [...prev, ...prepared]);
    }, []);

    return {
        clips,
        setClips,
        selectedClipId,
        setSelectedClipId,
        totalDuration,
        uploadBaseVideo,
        addClips,
        deleteClip,
        splitAtTime,
        splitAtPlayhead,
    };
}
