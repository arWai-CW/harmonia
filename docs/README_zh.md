<h1 align="center">Harmonia 🎵</h1>
<h3 align="center">極簡音樂理論與和弦進行工具</h3>

<div align="center">

Forked from: [不囉唆的和弦代號查詢器 by NiceChord 好和弦](https://github.com/wiwikuan/chordfinder)  
Modified by: arWai-CW

[![My Skills](https://skillicons.dev/icons?i=js,html,css,rust,tauri,vite)](https://skillicons.dev)

[English](https://github.com/arWai-CW/harmonia/blob/main/README.md) | 中文

</div>

---

## 🆕 新增功能

與原始 fork 版本的主要差異：
- 從零開始重寫所有 UI 介面
- 新增支援拖曳排序的「和弦進行建立器」
- 新增羅馬數字和弦功能分析
- 新增查詢歷史紀錄並支援 localStorage 持久化
- 使用 Tauri 打包為原生桌面應用程式

---

## ✨ 功能和用法

**Harmonia** 是一個網頁與桌面雙平台的音樂理論工具，旨在幫助音樂愛好者快速尋找和理解和弦結構。

### 🌟 核心功能

- **和弦解析**：只要輸入和弦代號（例如 Cmaj7、F#m7b5、Bb13），就能立即查看組成音。
- **樂譜顯示**：透過 ABC notation 於五線譜上顯示和弦。
- **調性分析**：選擇調性（如 C 大調或 A 小調）後，系統會自動顯示正確的音名拼寫與功能分析。
- **和弦進行建立器**：建立並儲存和弦進行，支援直覺的拖曳排序。
- **歷史紀錄追蹤**：自動儲存你的查詢紀錄，一鍵即可重新檢視查過的和弦。

### 💡 如何使用

1. 在「和弦代號」輸入框打上和弦名稱。
2. 選擇歌曲的調性（大調或小調）。
3. 即時檢視和弦組成音、樂譜顯示和和弦功能。
4. 點擊「加入」按鈕將和弦儲存至歷史紀錄或用來建立和弦進行。
5. 使用拖曳功能依喜好重新排序和弦。

### 🚀 快速開始

- **網頁模式**：執行 `bun run dev` 啟動開發伺服器（`localhost:5173`）。
- **桌面應用程式**：執行 `bun run t:dev` 啟動 Tauri 桌面應用程式。

---

## 🏗️ 系統架構

### 🛠️ 技術棧

- **前端**：Vanilla JavaScript + Tailwind CSS v4
- **桌面框架**：Tauri (Rust + 網頁技術)
- **音樂理論引擎**：Tonal.js (用於和弦分析)
- **樂譜渲染**：abcjs (用於 ABC notation 顯示)
- **UI 互動**：SortableJS (用於拖曳功能)

### 📁 程式碼結構

```text
harmonia/
├── src/                    # 前端原始碼
│   ├── main.js             # 應用程式進入點與狀態管理
│   ├── chord-utils.js      # 音樂理論工具函數
│   ├── chord-function.js   # 和弦功能分析 (羅馬數字)
│   ├── drag-utils.js       # 拖曳功能封裝
│   └── styles.css          # Tailwind CSS 樣式
├── src-tauri/              # Tauri 後端原始碼
└── tests/                  # 瀏覽器測試框架
```

### 🧠 核心概念

1. **工廠模式**：使用 `createStorage()` 與 `createState()` 來抽象化狀態管理。
2. **純函數**：所有的音樂理論邏輯皆使用純函數實作，無副作用。
3. **事件驅動**：依賴事件監聽器來處理使用者的互動。
4. **本地儲存**：使用 `localStorage` 來持久化保存歷史紀錄與設定。
5. **模組化設計**：每個功能皆分離獨立模組，明確區分關注點。

### 💻 開發工作流程

1. **安裝依賴**：`bun install`
2. **網頁開發伺服器**：`bun run dev`
3. **Tauri 開發伺服器**：`bun run t:dev`
4. **生產建置**：`bun run build` (網頁) 或 `bun run t:build` (桌面)
5. **執行測試**：於瀏覽器中打開 `tests/index.html`。

### ⚙️ 建議的 IDE 設定

- [VS Code](https://code.visualstudio.com/) + [Tauri 擴充套件](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## 🧭 設計哲學

- **簡潔直覺**：沒有多餘的雜訊；完全專注於和弦查詢的核心功能。
- **效能優先**：使用純 JavaScript 打造，避開龐大框架的額外開銷。
- **學習工具**：為希望了解和弦結構的音樂學生和作曲家量身打造。
- **跨平台**：可以順暢地作為網頁應用程式及桌面應用程式執行。

### 🎨 顏色編碼系統

- 🟢 **綠色**：主音功能 (Tonic function: I, iii, vi)
- 🔵 **藍色**：下屬音功能 (Subdominant function: ii, IV)
- 🔴 **紅色**：屬音功能 (Dominant function: V, vii°)
