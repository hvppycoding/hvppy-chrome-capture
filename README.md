# Page Capture to Click — Chrome Extension

A Chrome extension that captures a stitched screenshot from the **top of the page** down to the **point you click**, then saves it to your Downloads folder.

## Features

- **One-click activation**: Click the extension icon to enter capture mode.
- **Visual guide line**: A red horizontal line follows your cursor, showing exactly where the capture will end.
- **Automatic stitching**: Scrolls from the top and captures each viewport, then stitches them into a single image.
- **Auto-named downloads**: The saved PNG file is named after the page title (with a timestamp for uniqueness).
- **Toggle on/off**: Click the extension icon again to cancel capture mode.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this project folder.
4. The extension icon will appear in your toolbar.

## Usage

1. Navigate to any webpage you want to capture.
2. Click the **extension icon** in the toolbar.
3. A bottom bar appears: _"Click anywhere to capture from top to that point"_.
4. A **red guide line** follows your mouse — it marks the bottom boundary of the capture.
5. **Click** anywhere on the page.
6. The extension automatically:
   - Scrolls to the top of the page
   - Captures each viewport section
   - Stitches all sections into one tall image
   - Crops to your click point
   - Saves the result as a PNG in your Downloads folder
7. The filename uses the page's `<title>` plus a timestamp, e.g. `My Page Title_2026-02-11T14-30-00.png`.

## File Structure

```
manifest.json   — Extension manifest (Manifest V3)
background.js   — Service worker: handles tab capture & downloads
content.js      — Content script: UI, click handling, scroll & stitch
content.css     — Styles for the bottom bar, guide line & progress overlay
README.md       — This file
```

## Permissions

| Permission  | Reason |
|-------------|--------|
| `activeTab` | Capture the visible tab contents |
| `downloads` | Save the final screenshot to the Downloads folder |
| `scripting` | Inject the content script and styles into the active tab |

## Limitations

- **Fixed/sticky headers** may appear duplicated in the stitched image because they are present in every viewport capture.
- Very long pages may produce large images; canvas size limits apply (browser-dependent, typically ~16k px).
- Only works on standard web pages — `chrome://`, `chrome-extension://`, and browser internal pages are not supported.

## License

MIT
