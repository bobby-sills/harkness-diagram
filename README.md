# Harkness Spiderweb

A browser app for mapping who talks during a Harkness discussion. Tap each
student as they speak and it draws the classic "spiderweb": a line from each
speaker to the one before, with lines getting thicker as the same pair keeps
talking back and forth.

No install, no account, no build step. Open `index.html` in a browser, or
host the folder on any static host (GitHub Pages works as-is).

## Using it

1. **Roster tab**: add the people at the table one at a time, or paste a
   whole class list (one name per line or comma-separated). Seats are spread
   evenly around the table.
2. **Arrange seats**: switch to this mode and drag each seat to where that
   person is actually sitting. Arrow keys nudge a focused seat
   (Shift + arrow for bigger steps).
3. **Record**: tap whoever is speaking. The timer starts on the first turn.
   - The most recent exchange is highlighted with an arrow showing direction.
   - Dashed seats mark people who haven't spoken yet.
   - Tag the latest turn as a **Q**uestion, **T**ext citation, **B**uilding
     on a peer, or **I**nterruption with the chips or the Q/T/B/I keys.
   - **Undo** (or Ctrl/Cmd + Z) removes the last turn. Any turn can be
     deleted from the **Log** tab.
4. **Summary tab**: turns, voices heard, a 0–100 balance score (100 means
   everyone spoke equally often, computed as 1 − Gini), the most frequent
   exchange, who hasn't been heard yet, and per-person counts and tags.
5. **Replay**: drag the slider under the map to watch the web build up turn
   by turn.
6. **Save image** exports a PNG of the map with the title and stats, for
   sharing with students or dropping into a gradebook.
7. **New discussion** keeps the same seating (or starts with an empty table).
   Everything saves automatically in the browser; the **Saved** tab lists past
   discussions and can export/import a `.harkness.json` file to move data
   between devices or back it up. It can also copy a plain-text summary.

Data stays in the browser's local storage. Nothing is sent anywhere.

## Files

- `index.html`: page structure
- `styles.css`: styling, including light and dark themes
- `app.js`: all app logic (rendering the SVG map, recording, stats, storage, export)
