"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime } from "../utils";

type Props = {
    timelineTime: number;
    totalDuration: number;
    isPlaying: boolean;
    hasClips: boolean;
    onPlayToggle: () => void;
    onReset: () => void;
    onSeek: (time: number) => void;
};

const PlaybackControls = ({
    timelineTime,
    totalDuration,
    isPlaying,
    hasClips,
    onPlayToggle,
    onReset,
    onSeek,
}: Props) => (
    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#11151b] px-5 py-3">
        <div className="flex items-center gap-3">
            <Button
                variant="secondary"
                size="icon"
                onClick={onPlayToggle}
                disabled={!hasClips}
            >
                {isPlaying ? (
                    <Pause className="size-4" />
                ) : (
                    <Play className="size-4" />
                )}
            </Button>
            <p className="text-xs text-slate-400">
                {formatTime(timelineTime)} / {formatTime(totalDuration)}
            </p>
        </div>
        <div className="flex items-center gap-2">
            <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
            >
                Reset
            </Button>
            <Input
                type="range"
                min={0}
                max={totalDuration || 0}
                step={0.01}
                value={timelineTime}
                onChange={(e) => onSeek(Number.parseFloat(e.target.value))}
                className="w-48"
                disabled={totalDuration === 0}
            />
        </div>
    </div>
);

export default PlaybackControls;
