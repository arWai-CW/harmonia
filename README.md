<h1 align="center">Harmonia 🎵</h1>
<h3 align="center">A Minimalist Music Theory & Chord Progression Tool</h3>

<div align="center">

Forked from: [不囉唆的和弦代號查詢器 by NiceChord 好和弦](https://github.com/wiwikuan/chordfinder)  
Modified by: arWai-CW

[![My Skills](https://skillicons.dev/icons?i=js,html,css,rust,tauri,vite)](https://skillicons.dev)


English | [中文](https://github.com/arWai-CW/harmonia/blob/main/docs/README_zh.md)

</div>

---

## 🆕 What I added

Changes from the original fork:
- Rebuilt the entire UI from scratch
- Added chord progression builder with drag-and-drop reordering
- Added chord analysis with Roman numeral notation
- Added query history with localStorage persistence
- Packaged as a native desktop app using Tauri

---

## ✨ Features and Usage

**Harmonia** is a web and desktop music theory tool designed to help music enthusiasts quickly look up and understand chord structures.

### 🌟 Core Features

- **Chord Parsing**: Simply input a chord symbol (e.g., Cmaj7, F#m7b5, Bb13) to instantly view its constituent notes.
- **Sheet Music Render**: Displays chords on a musical staff using ABC notation.
- **Harmonic Analysis**: Select a key (e.g., C Major or A Minor) to automatically view the correct note spellings and functional analysis.
- **Chord Progression Builder**: Create and save chord progressions with drag-and-drop reordering support.
- **History Tracking**: Automatically saves your lookup history, allowing one-click review of past chords.

### 💡 How to Use

1. Enter a chord name in the "Chord Symbol" input field.
2. Select the song's key (Major or Minor).
3. Instantly view the chord's notes, sheet music representation, and harmonic function.
4. Click the "Add" button to save it to your history or build a chord progression.
5. Use the drag-and-drop feature to rearrange the chord sequence to your liking.

### 🚀 Quick Start

- **Web Mode**: Run `bun run dev` to start the development server at `localhost:5173`.
- **Desktop Application**: Run `bun run t:dev` to launch the Tauri desktop app.

---

## 🏗️ Architecture

### 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript + Tailwind CSS v4
- **Desktop Framework**: Tauri (Rust + Web Technologies)
- **Music Theory Engine**: Tonal.js for chord analysis
- **Sheet Music Render**: abcjs for ABC notation display
- **UI Interaction**: SortableJS for drag-and-drop functionality

### 📁 Code Structure

```text
harmonia/
├── src/                    # Frontend source code
│   ├── main.js             # Application entry point & state management
│   ├── chord-utils.js      # Music theory utility functions
│   ├── chord-function.js   # Harmonic function analysis (Roman numerals)
│   ├── drag-utils.js       # Drag-and-drop wrapper
│   └── styles.css          # Tailwind CSS styles
├── src-tauri/              # Tauri backend source code
└── tests/                  # Browser-based test framework
```

### 🧠 Core Concepts

1. **Factory Pattern**: Uses `createStorage()` and `createState()` to abstract state management.
2. **Pure Functions**: All music theory logic is built using pure functions without side effects.
3. **Event-Driven**: Relies on event listeners to handle user interactions.
4. **Local Storage**: Uses `localStorage` to persist history and settings.
5. **Modular Design**: Each feature is separated into its own module for clear separation of concerns.

### 💻 Development Workflow

1. **Install Dependencies**: `bun install`
2. **Web Dev Server**: `bun run dev`
3. **Tauri Dev Server**: `bun run t:dev`
4. **Production Build**: `bun run build` (Web) or `bun run t:build` (Desktop)
5. **Run Tests**: Open `tests/index.html` in your browser.

### ⚙️ Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## 🧭 Design Philosophy

- **Simple & Intuitive**: No unnecessary clutter; strictly focused on core chord lookup functionality.
- **Performance First**: Built with pure JavaScript, avoiding heavy framework overhead.
- **Educational Tool**: Perfectly tailored for music students and composers wanting to understand chord structures.
- **Cross-Platform**: Runs seamlessly as both a web application and a desktop app.

### 🎨 Color Coding System

- 🟢 **Green**: Tonic function (I, iii, vi)
- 🔵 **Blue**: Subdominant function (ii, IV)
- 🔴 **Red**: Dominant function (V, vii°)）
