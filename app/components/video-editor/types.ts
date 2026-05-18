export type Clip = {
    id: string;
    file: File;
    url: string;
    name: string;
    start: number;
    end: number;
    duration: number;
    hasAudio: boolean;
    width: number;
    height: number;
};

export type OverlayType = "text" | "rect" | "circle" | "line";

export type ExportResolution = "source" | "720p" | "1080p";

export type Overlay = {
    id: string;
    type: OverlayType;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    fillEnabled: boolean;
    strokeColor: string;
    strokeWidth: number;
    fontSize: number;
    startTime: number;
    endTime: number;
};
