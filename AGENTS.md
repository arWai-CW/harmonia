# Repository Guidelines for Agentic Coding

## Project Overview

**Harmonia** - A Tauri + Vite + Vanilla JS application for chord lookup and progression management. It's a music theory tool that parses chord symbols, displays their notes, renders sheet music via ABC notation, and analyzes harmonic functions. Built by NiceChord 好和弦 with modifications by arWai.

---

## Project Structure & Module Organization

### Directory Layout

```
harmonia/
├── src/                    # Frontend source (Vite root)
│   ├── index.html          # Main HTML with embedded modal logic
│   ├── main.js             # Application entry point (thin initializer)
│   ├── state.js            # State management & localStorage persistence
│   ├── renderer.js         # DOM rendering & ABC notation display
│   ├── events.js           # Event binding & input handling
│   ├── window-manager.js   # Floating window drag/resize & state persistence
│   ├── styles.css          # Tailwind CSS v4 with custom components
│   ├── chord-utils.js      # Music theory utilities (chord parsing, key definitions)
│   ├── chord-function.js   # Harmonic function analysis (Roman numerals)
│   ├── midi-utils.js       # MIDI parsing, chord segmentation, base triad
│   ├── midi-panel.js       # MIDI tab: timeline, piano roll, playback
│   ├── i18n/               # UI strings (en, zh-TW, zh-CN, ja)
│   ├── tests/              # Browser-based test framework
│   │   ├── index.html      # Test runner
│   │   ├── chord-utils.test.js
│   │   ├── chord-function.test.js
│   │   └── midi-utils.test.js
│   └── assets/             # Static assets (tauri.svg, javascript.svg)
├── src-tauri/              # Tauri desktop app backend
│   ├── src/                # Rust source code
│   ├── icons/              # Application icons
│   ├── Cargo.toml          # Rust package configuration
│   └── tauri.conf.json     # Tauri app configuration
├── dist/                   # Build output (gitignored)
├── package.json           # Node.js dependencies and scripts
├── vite.config.js         # Vite build configuration
├── bun.lock               # Bun lockfile
└── .vscode/extensions.json # Recommended VS Code extensions
```

### Module Architecture

- **ES6 Modules**: All JavaScript files use `import`/`export` syntax
- **Separation of Concerns**:
    - `main.js`: Thin initialization layer, coordinates modules
    - `state.js`: State management & localStorage persistence
    - `renderer.js`: DOM rendering & ABC notation display
    - `events.js`: Event binding, input handling & business logic
    - `window-manager.js`: Floating window drag/resize & state persistence
    - `chord-utils.js`: Pure music theory utilities (no side effects)
    - `chord-function.js`: Harmonic analysis logic
    - `midi-utils.js`: Pure MIDI parsing and chord segmentation
    - `midi-panel.js`: MIDI tab controller (`createMidiPanel(state)`)
- **Single-Page Application**: All UI logic in one HTML file with embedded modal
- **Factory Pattern**: `createStorage()`, `createState()` for abstraction

---

## Build, Test, and Development Commands

### Package Manager: Bun

- Uses Bun for package management (`bun.lock` present)
- All npm scripts should be run with `bun run <script>`

### Available Scripts (from package.json)

| Script            | Purpose                               | Notes                                  |
| ----------------- | ------------------------------------- | -------------------------------------- |
| `bun run dev`     | Start Vite dev server                 | Runs on `localhost:5173`               |
| `bun run build`   | Production build to `dist/` directory |                                        |
| `bun run preview` | Preview production build              |                                        |
| `bun run tauri`   | Run Tauri CLI commands                |                                        |
| `bun run t:dev`   | Start Tauri dev mode                  | Combines Vite dev server with Tauri    |
| `bun run t:build` | Build Tauri desktop app               | Generates platform-specific installers |

### Build Configuration (vite.config.js)

```javascript
{
  root: "src",                    // Source directory
  plugins: [tailwindcss()],       // TailwindCSS v4 plugin
  build: {
    outDir: "../dist",           // Output directory
    emptyOutDir: true            // Clean output before build
  },
  server: {
    port: 5173,                  // Dev server port
    strictPort: true             // Fail if port unavailable
  }
}
```

### Running Tests

**Custom Browser-Based Test Framework**:

- No Jest/Vitest/Mocha installed
- Tests run via Vite dev server (ES modules require CORS)
- Custom test harness in `chord-utils.test.js` with `assertEqual()` and `test()` helpers

**To run tests**:

1. Start dev server: `bun run dev`
2. Open `http://localhost:5173/tests/index.html` in browser
3. Tests auto-execute and display results with styling

**To add tests**:

1. Create new `.test.js` file in `src/tests/` directory
2. Export a `runXxxTests()` function following existing pattern
3. Import and add to `tests/index.html`

---

## Coding Style & Naming Conventions

### File Naming

- **JavaScript**: kebab-case (`chord-utils.js`, `drag-utils.js`)
- **HTML/CSS**: kebab-case (`index.html`, `styles.css`)
- **Test files**: `.test.js` suffix (`chord-utils.test.js`)

### JavaScript Style

- **Variables**: camelCase (`currentChord`, `progression`)
- **Constants**: UPPER_SNAKE_CASE (`STORAGE_KEYS`, `MAJOR_ROOTS`)
- **Functions**: camelCase with descriptive verbs (`sanitizeChordInput`, `renderProgression`)
- **Classes**: PascalCase (not currently used in codebase)
- **Imports**: Destructured imports preferred
    ```javascript
    import { getKeyDefinition, spellNotesInKey } from "./chord-utils.js";
    ```

### HTML Style

- **Indentation**: 4 spaces (not tabs)
- **Language**: Traditional Chinese (`lang="zh-Hant"`)
- **Semantic markup**: Proper use of `<section>`, `<header>`, `<main>`, etc.
- **Tailwind classes**: Utility-first approach with custom component classes
- **Accessibility**: Proper `aria-label`, `role` attributes on interactive elements

### CSS Style (Tailwind v4)

- **Custom theme**: Defined in `@theme` block in `styles.css`
- **Component classes**: BEM-like naming with `@apply`
    ```css
    .glass-card {
    	@apply rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-lg;
    }
    .chip--green {
    	@apply bg-green-500/15 text-green-700;
    }
    ```
- **Color coding by function**:
    - Green (`chip--green`): Tonic function (I, iii, vi)
    - Blue (`chip--blue`): Subdominant function (ii, IV)
    - Red (`chip--red`): Dominant function (V, vii°)

### Error Handling

- **Defensive programming**: Use optional chaining (`?.`), nullish coalescing (`??`)
- **Try-catch**: Wrap localStorage operations in try-catch blocks
- **Early returns**: Reduce nesting, handle edge cases first
- **No global variables**: All state encapsulated in modules/functions

### State Management Pattern

```javascript
// Factory pattern for storage abstraction (state.js)
const createStorage = (backend) => ({
	load(key, fallback) {
		try {
			const raw = backend.getItem(key);
			return raw ? (JSON.parse(raw) ?? fallback) : fallback;
		} catch {
			return fallback;
		}
	},
	save(key, value) {
		backend.setItem(key, JSON.stringify(value));
	},
});

// Centralized state container (state.js)
const createState = (storage) => ({
	currentChord: null,
	progression: storage.load(STORAGE_KEYS.PROGRESSION, []),
	progressionHistory: storage.load(STORAGE_KEYS.PROGRESSION_HISTORY, []),
	keyRoot: storage.load(STORAGE_KEYS.KEY_ROOT, "C"),
	keyMode: storage.load(STORAGE_KEYS.KEY_MODE, "major"),
});
```

---

## Dependencies & External Libraries

### Production Dependencies

| Library             | Version | Purpose                                             |
| ------------------- | ------- | --------------------------------------------------- |
| `tonal`             | ^6.4.3  | Music theory library for chord parsing and analysis |
| `abcjs`             | ^6.6.1  | ABC notation rendering (sheet music display)        |
| `tailwindcss`       | ^4.1.18 | Utility-first CSS framework (v4)                    |
| `@tailwindcss/vite` | ^4.1.18 | Tailwind Vite plugin                                |
| `sortablejs`        | ^1.15.6 | Drag-and-drop functionality for progression items   |

### Development Dependencies

| Library           | Version | Purpose                            |
| ----------------- | ------- | ---------------------------------- |
| `vite`            | ^5.4.0  | Build tool and dev server          |
| `@tauri-apps/cli` | ^2      | Tauri CLI for desktop app building |

### Tauri Configuration

- **App ID**: `com.wai.harmonia`
- **Window Size**: 800×600
- **Build Command**: Uses `bun run build`
- **Frontend Directory**: `../dist`
- **Backend**: Rust with `tauri` and `opener` crates

---

## Commit & Pull Request Guidelines

### Commit Messages

- **Format**: Short, imperative sentences (e.g., "Update chord parsing logic")
- **Language**: English preferred for technical commits
- **Scope**: Focused, atomic changes

### Pull Requests

- Include brief description of changes
- Add verification steps (how to test)
- Include screenshots for UI changes
- Reference related issues if applicable

### Branch Strategy

- `main`: Production-ready code
- Feature branches: `feature/<description>`
- Bug fix branches: `fix/<description>`

---

## Security & Configuration Tips

### Third-Party Scripts

- All dependencies are versioned in `package.json` with pinned versions
- No CDN scripts; all libraries are bundled locally
- Keep `bun.lock` committed for reproducible builds

### Environment Configuration

- No `.env` files needed (static app)
- Tauri config in `src-tauri/tauri.conf.json`
- Vite config in `vite.config.js`

### Adding New Features

1. **Music theory logic**: Extend `chord-utils.js` or `chord-function.js`
2. **UI components**: Add Tailwind component classes in `styles.css`
3. **State management**: Update `STORAGE_KEYS` and `createState()` as needed
4. **Tests**: Add to `tests/` directory following existing pattern

### Performance Considerations

- Debounced input handling in `main.js`
- ABC.js rendering optimized with memoization
- LocalStorage operations are lightweight and non-blocking

---

## VS Code Configuration

### Recommended Extensions

- `tauri-apps.tauri-vscode` - Tauri development support
- `rust-lang.rust-analyzer` - Rust language support
- Tailwind CSS IntelliSense (if using Tailwind extension)

### Settings

- No project-specific `.vscode/settings.json` present
- Default TypeScript/JavaScript settings apply

---

## Key Architectural Decisions

### 1. Vanilla JS over Framework

- No React/Vue/Angular dependencies
- Direct DOM manipulation for simplicity
- Modular ES6 architecture

### 2. TailwindCSS v4

- Utility-first styling
- Custom theme with CSS custom properties
- Component classes using `@apply`

### 3. Tauri for Desktop

- Cross-platform desktop packaging
- Rust backend with JavaScript frontend
- Single codebase for web and desktop

### 4. Custom Test Framework

- Lightweight, browser-based testing
- No test runner dependencies
- Easy to extend with new test files

### 5. Factory Pattern Abstraction

- `createStorage()` abstracts localStorage
- `createState()` centralizes application state
- Easy to swap storage backends if needed

### 6. Module Decomposition

- `main.js` is a thin initializer (~80 lines)
- `state.js` owns state transitions and persistence
- `renderer.js` owns DOM rendering
- `events.js` owns event binding and business logic
- `window-manager.js` owns floating window behavior
- Clear dependency graph: main → events → renderer → chord-utils

---

## Codebase Maturity Assessment

**State**: **Disciplined** ✅

- Consistent patterns across files
- Clear separation of concerns
- Well-documented architecture
- No linting/formatter configs (consider adding ESLint/Prettier)
- Tests exist but use custom framework

**Recommendations for Agents**:

1. Follow existing naming conventions strictly
2. Maintain factory pattern for new abstractions
3. Add tests using the custom test harness pattern
4. Use Tailwind utility classes rather than custom CSS
5. Keep state management centralized in `main.js`
6. Use defensive programming patterns (`?.`, `??`, try-catch)
7. Add new chord functions to `chord-utils.js` or `chord-function.js`
8. Add new UI components as Tailwind component classes in `styles.css`
