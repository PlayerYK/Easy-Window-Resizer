# Easy Window Resizer

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/hookmbjihljbnldhphbjbakfbeppogag?style=flat-square&logo=google-chrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/easy-window-resizer/hookmbjihljbnldhphbjbakfbeppogag)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/hookmbjihljbnldhphbjbakfbeppogag?style=flat-square&logo=google-chrome&logoColor=white&label=Users&color=34A853)](https://chromewebstore.google.com/detail/easy-window-resizer/hookmbjihljbnldhphbjbakfbeppogag)
[![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/hookmbjihljbnldhphbjbakfbeppogag?style=flat-square&logo=google-chrome&logoColor=white&label=Rating&color=FBBC04)](https://chromewebstore.google.com/detail/easy-window-resizer/hookmbjihljbnldhphbjbakfbeppogag)

English | [简体中文](./README.md)

A Chrome extension for quickly resizing and positioning browser windows. Recent updates focus on "positioning within current screen only" - windows stay on the current display in multi-monitor setups, with minimal required permissions.

## Features

- Preset Sizes: Built-in common resolutions, apply with one click, removable
- Custom Sizes: Enter any width/height, save as preset, get current window size with one click
- Recent History: Automatically records last 5 sizes for quick reuse
- Position Control: Top-left / Top-right / Center / Bottom-left / Bottom-right; automatically positions within "current screen" after resizing

## Recent Updates (Developer-Focused)

- Current Screen Positioning: Injects script to read `screen.availLeft/Top/Width/Height`, ensuring windows stay on the current display
- Removed ChromeOS Dependencies: Eliminated `chrome.system.display` usage to avoid failures on macOS/Windows
- Minimal Permissions: Uses `activeTab` + `scripting` for temporary injection, avoiding sensitive `tabs` permission
- State Handling & Fallback: Restores maximized/fullscreen to normal first; for restricted pages (e.g., `chrome://`) where injection fails, only resizes without forcing position

## Permissions Explained (Manifest V3)

- `windows`: Resize and position browser windows
- `storage`: Save presets, recent history, position preferences
- `scripting`: Inject script into active tab to read current screen boundaries
- `activeTab`: Temporary authorization for current active tab on user gesture

Removed: `system.display` (ChromeOS-specific, unavailable on desktop platforms).

## How It Works (Simplified)

- Resize: `chrome.windows.update(windowId, { width, height })`
- Current Screen Bounds: Inject script into active tab, read `screen.availLeft/Top/Width/Height`
- Position Calculation: Calculate target `left/top` based on screen bounds and window size, then `chrome.windows.update(windowId, { left, top })`
- Fallback Handling: Skip positioning if injection fails (special pages), only perform resize

## Installation & Usage

1. Install from Chrome Web Store
2. Or load manually:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select project directory

## Build

Provides Windows/Mac/Linux scripts that output `Easy_window_resizer_v[version].zip` based on `manifest.json` version, excluding unnecessary files.

- Windows: Run `build.bat`
- Mac/Linux: First run `chmod +x build.sh`, then `./build.sh`

## Project Structure

```
├── manifest.json        # Extension configuration
├── background.js        # Background: positioning logic, message handling
├── popup.html/.css/.js  # Popup UI and interactions
├── i18n.js              # Internationalization initialization
├── _locales/            # Language resources (en, zh_CN)
└── images/              # Icons
```

## Compatibility & Limitations

- Platforms: macOS / Windows (multi-display support, always stays on "current screen")
- Special Pages: `chrome://`, extension store, etc. cannot inject scripts, falls back to resize only
- Window States: Maximized/fullscreen windows are restored to normal before repositioning

## Feedback & Contributions

- Issues or suggestions: Submit via feedback link in extension
- PR Guidelines: Maintain consistent style, provide necessary explanations, verify functionality before submitting

License: MIT
