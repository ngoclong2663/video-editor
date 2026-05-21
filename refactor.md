# UI/UX Refactor Tasks

Reference screenshots in `docs/imgs/` for current UI context.

---

## 1. Upload Media — Remove Redundant File Inputs

**Current state:** The upload area in `media-panel.tsx` renders two `<input type="file">` buttons labeled "Choose File" and "Choose Files" below the drag-and-drop zone (visible in `docs/imgs/main-ui.png`).

**Required change:** Remove both `<input>` elements. The entire upload zone (the area with the upload icon and "Upload media files" label) should act as the single click target. Clicking anywhere on it opens a single native file picker with `multiple` selection enabled. Drag-and-drop onto the zone should continue to work.

---

## 2. Clips List — Replace Text Cards with Video Thumbnails

**Current state:** `clips-list.tsx` renders each clip as a text card showing only the clip name.

**Required change:** Replace the card with a visual thumbnail — render a `<video>` element (or extract a poster frame) so the user can see a preview of the clip content. The thumbnail should be draggable onto the timeline (existing drag-and-drop behavior must be preserved).

---

## 3. Timeline — Split: Allow Deleting Split Segments

**Current state:** After using "Split at playhead", the resulting segments cannot be individually deleted from the timeline.

**Required change:** Each segment produced by a split must be independently selectable and deletable. Deleting one segment should not affect the others.

---

## 4. Timeline — Drag-and-Drop Auto-Scroll

**Current state:** When dragging a clip or overlay in the timeline and the cursor reaches the right edge, the timeline does not scroll, making it impossible to drop items beyond the visible area.

**Required change:** While a drag is in progress, if the dragged item's right edge approaches the right boundary of the timeline viewport, the timeline should automatically scroll rightward at a proportional speed. Scrolling stops when the drag ends or the cursor moves back toward the center.

---

## 5. Timeline — Overlays: Multi-Level Tracks (Z-Index Lanes)

**Current state:** All overlays (text, rectangle, circle, etc.) share a single "Overlays" row in the timeline (`docs/imgs/timeline-control.png`). This makes it impossible to precisely position overlapping overlays in time or change their stacking order.

**Required change:**
- Each overlay occupies its own horizontal lane inside the Overlays section.
- Lanes are stacked vertically; the topmost lane = highest z-index in the preview.
- A user can drag an overlay block vertically to a different lane (above or below another overlay), which reorders z-index accordingly.
- Dragging horizontally within a lane changes the overlay's start time on the timeline (existing behavior).
- New overlays are added to a new lane at the bottom by default.

---

## 6. New Overlay Default Timing — Snap to Playhead

**Current state:** When the user adds a text or shape overlay, it is placed at time 0 regardless of where the playhead is.

**Required change:** When the user adds any overlay (text, rectangle, circle, etc.), set its `startTime` to the current playhead position (`timelineTime`) and its `endTime` to `timelineTime + 10` seconds (capped at total duration). This applies to all overlay types added via the sidebar or toolbar buttons.
