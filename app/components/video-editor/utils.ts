export const formatTime = (value: number): string => {
    if (!Number.isFinite(value)) return "00:00";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};
