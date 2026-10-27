---
name: whiteboard
description: Explain something by sketching it on a hand-drawn whiteboard. Use when teaching or walking someone through a concept, architecture, data flow, mental model or comparison and a picture helps; when the user says "draw it", "sketch", "whiteboard", "explain visually", "teach me"; or when boxes, arrows and notes laid out in space say more than a list. Claude Lens renders ```excalidraw blocks as live, editable Excalidraw boards.
---

# Whiteboard sketches in Claude Lens

Claude Lens draws a fenced ```excalidraw block as a hand-drawn Excalidraw board, and the user can open it full screen to move things around and draw on it. Reach for it when you're **teaching**: the free layout (groups, notes, side-by-side comparisons, a highlighted "you are here") is the point. For a plain flow or sequence, a ```mermaid diagram is usually enough.

## Format

A JSON array of simple elements. Lens fills in sizes and wires the arrows for you.

```excalidraw
[
  { "type": "text", "x": 0, "y": -70, "text": "How a request gets an answer", "fontSize": 24 },
  { "type": "rectangle", "id": "ui", "x": 0, "y": 0, "label": { "text": "Browser" } },
  { "type": "rectangle", "id": "api", "x": 320, "y": 0, "label": { "text": "API" }, "backgroundColor": "#ffec99" },
  { "type": "ellipse", "id": "db", "x": 640, "y": 0, "label": { "text": "Postgres" } },
  { "type": "arrow", "start": { "id": "ui" }, "end": { "id": "api" }, "label": { "text": "POST /ask" } },
  { "type": "arrow", "start": { "id": "api" }, "end": { "id": "db" } },
  { "type": "text", "x": 320, "y": 110, "text": "slow part: 2 queries per call", "fontSize": 16, "strokeColor": "#e03131" }
]
```

- **Shapes:** `rectangle`, `ellipse`, `diamond`. Give each an `id`, an `x`/`y` (top-left, in pixels) and a `label: { "text": … }`. Default size is 180×80; set `width`/`height` for big or small ones.
- **Arrows:** `{ "type": "arrow", "start": { "id": … }, "end": { "id": … } }`, plus an optional `label`. They attach to the shapes.
- **Notes and titles:** `{ "type": "text", "x", "y", "text", "fontSize" }`.
- **Colors (sparingly):** `backgroundColor` for fills, `strokeColor` for outlines and text. Soft fills work best: `#ffec99` yellow, `#b2f2bb` green, `#a5d8ff` blue, `#ffc9c9` red, `#e5dbff` purple. Use one color to mean one thing.

## Layout

- Lay it out on a grid: columns about 320px apart, rows about 180px apart, so arrow labels fit in the gaps. Keep 6 to 14 shapes.
- Keep arrow labels to two or three words.
- Left to right for flows; top to bottom for layers (UI, API, data).
- Group related things in a row or column, and put a title at the top.
- Use a red or highlighted note for the one thing you want them to remember.

## Teaching with it

- One or two plain sentences before the board, saying what it shows.
- After it, explain step by step, using the same names that are on the board.
- If the idea has stages, draw one board per stage rather than one huge board.
- Real names from the code (services, functions, tables), not placeholders.
