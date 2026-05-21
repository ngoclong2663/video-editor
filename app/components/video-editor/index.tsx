"use client";

import * as React from "react";
import { arrayMove } from "react-movable";

import VideoEditorPreview from "./preview";
import EditorHeader from "./components/editor-header";
import ToolsSidebar from "./components/tools-sidebar";
import MediaPanel from "./components/media-panel";
import PlaybackControls from "./components/playback-controls";
import Timeline from "./components/timeline";

import { useClipAction } from "./hooks/use-clip-action";
import { useOverlayAction } from "./hooks/use-overlay-action";
import { useTimelineAction } from "./hooks/use-timeline-action";
import { useFfmpeg } from "./hooks/use-ffmpeg";

import type { Overlay, OverlayType } from "./types";

const VideoEditor = () => {
    // Preview canvas viewport — shared between preview and ffmpeg export
    const [previewViewport, setPreviewViewport] = React.useState({
        width: 1280,
        height: 720,
    });
    const handleViewportChange = React.useCallback((w: number, h: number) => {
        setPreviewViewport((prev) =>
            prev.width === w && prev.height === h ? prev : { width: w, height: h },
        );
    }, []);

    const {
        timelineTime,
        setTimelineTime,
        isPlaying,
        setIsPlaying,
        timelineZoom,
        zoomIn,
        zoomOut,
    } = useTimelineAction();

    const {
        clips,
        setClips,
        selectedClipId,
        setSelectedClipId,
        totalDuration,
        uploadBaseVideo,
        addClips,
        deleteClip,
        splitAtPlayhead,
    } = useClipAction();

    const {
        overlays,
        setOverlays,
        selectedOverlay,
        selectedOverlayId,
        setSelectedOverlayId,
        addOverlay,
        updateOverlay,
        updateOverlayPosition,
        updateOverlayGeometry,
    } = useOverlayAction();

    const {
        exportResolution,
        setExportResolution,
        exportProgress,
        exportUrl,
        exportError,
        isExporting,
        resetExport,
        handleExport,
    } = useFfmpeg(clips, overlays, previewViewport);

    // ── Composed handlers (cross-cutting concerns) ────────────────────────────

    const handleDeleteClip = React.useCallback(
        (id: string) => {
            deleteClip(id);
            setTimelineTime(0);
            resetExport();
        },
        [deleteClip, setTimelineTime, resetExport],
    );

    // Keyboard delete for selected clip
    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            if (
                document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement
            )
                return;
            if (selectedClipId) handleDeleteClip(selectedClipId);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleDeleteClip, selectedClipId]);

    const handleUploadBase = React.useCallback(
        async (files: File[]) => {
            await uploadBaseVideo(files);
            setTimelineTime(0);
            resetExport();
        },
        [uploadBaseVideo, setTimelineTime, resetExport],
    );

    const handleAddClips = React.useCallback(
        async (files: File[]) => {
            await addClips(files);
            resetExport();
        },
        [addClips, resetExport],
    );

    const handleAddOverlay = React.useCallback(
        (type: OverlayType) => {
            addOverlay(type, totalDuration, timelineTime);
        },
        [addOverlay, totalDuration, timelineTime],
    );

    const handleOverlayUpdate = React.useCallback(
        (patch: Partial<Overlay>) => {
            if (!selectedOverlayId) return;
            updateOverlay(selectedOverlayId, patch);
        },
        [updateOverlay, selectedOverlayId],
    );

    const handleTimelineSeek = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (totalDuration === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(
                Math.max((e.clientX - rect.left) / rect.width, 0),
                1,
            );
            setTimelineTime(ratio * totalDuration);
        },
        [totalDuration, setTimelineTime],
    );

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1a2230_0,#0b0d10_45%,#07080a_100%)] text-slate-100">
            <EditorHeader
                isExporting={isExporting}
                exportProgress={exportProgress}
                hasClips={clips.length > 0}
                onExport={handleExport}
            />

            <div className="flex min-h-[calc(100vh-72px)]">
                <ToolsSidebar
                    hasClips={clips.length > 0}
                    onSplitAtPlayhead={() => splitAtPlayhead(timelineTime)}
                    onAddOverlay={handleAddOverlay}
                />

                <MediaPanel
                    clips={clips}
                    overlays={overlays}
                    selectedClipId={selectedClipId}
                    selectedOverlay={selectedOverlay}
                    selectedOverlayId={selectedOverlayId}
                    onUploadBase={handleUploadBase}
                    onAddClips={handleAddClips}
                    onClipSelect={setSelectedClipId}
                    onClipDelete={handleDeleteClip}
                    onClipsReorder={(oldIndex, newIndex) =>
                        setClips((prev) => arrayMove(prev, oldIndex, newIndex))
                    }
                    onOverlaySelect={setSelectedOverlayId}
                    onOverlaysReorder={(oldIndex, newIndex) =>
                        setOverlays((prev) => arrayMove(prev, oldIndex, newIndex))
                    }
                    onOverlayUpdate={handleOverlayUpdate}
                />

                <main className="flex flex-1 flex-col">
                    <div className="flex flex-1 flex-col gap-4 p-5">
                        <div className="rounded-3xl border border-white/5 bg-[#0f131a] p-4">
                            <VideoEditorPreview
                                clips={clips}
                                overlays={overlays}
                                currentTime={timelineTime}
                                isPlaying={isPlaying}
                                onTimeChange={setTimelineTime}
                                onPlaybackEnd={() => setIsPlaying(false)}
                                onOverlaySelect={setSelectedOverlayId}
                                selectedOverlayId={selectedOverlayId}
                                onOverlayPositionChange={updateOverlayPosition}
                                onOverlayResize={updateOverlayGeometry}
                                onPlayStateChange={setIsPlaying}
                                onViewportChange={handleViewportChange}
                            />
                        </div>

                        <PlaybackControls
                            timelineTime={timelineTime}
                            totalDuration={totalDuration}
                            isPlaying={isPlaying}
                            hasClips={clips.length > 0}
                            onPlayToggle={() => setIsPlaying((prev) => !prev)}
                            onReset={() => {
                                setTimelineTime(0);
                                setIsPlaying(false);
                            }}
                            onSeek={setTimelineTime}
                        />
                    </div>

                    <Timeline
                        clips={clips}
                        overlays={overlays}
                        selectedClipId={selectedClipId}
                        selectedOverlayId={selectedOverlayId}
                        timelineTime={timelineTime}
                        totalDuration={totalDuration}
                        timelineZoom={timelineZoom}
                        exportResolution={exportResolution}
                        exportUrl={exportUrl}
                        exportError={exportError}
                        onClipSelect={setSelectedClipId}
                        onClipDelete={handleDeleteClip}
                        onClipsReorder={(oldIndex, newIndex) =>
                            setClips((prev) => arrayMove(prev, oldIndex, newIndex))
                        }
                        onOverlaySelect={setSelectedOverlayId}
                        onOverlayMove={(id, start, end) =>
                            updateOverlay(id, { startTime: start, endTime: end })
                        }
                        onOverlayReorder={(oldIndex, newIndex) =>
                            setOverlays((prev) => arrayMove(prev, oldIndex, newIndex))
                        }
                        onSplitAtPlayhead={() => splitAtPlayhead(timelineTime)}
                        onTimelineSeek={handleTimelineSeek}
                        onZoomIn={zoomIn}
                        onZoomOut={zoomOut}
                        onResolutionChange={setExportResolution}
                    />
                </main>
            </div>
        </div>
    );
};

export default VideoEditor;
