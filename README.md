<div align="center">
  <img src="icons/icon128.png" alt="Dendrite Logo" width="128" />

  # <img src="https://api.iconify.design/lucide:brain.svg?color=white" width="32" height="32" align="absmiddle" /> Dendrite
  **A Neural Navigator for your LLM Conversations**

  [![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)]()
  [![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Brave%20%7C%20Edge-lightgrey.svg)]()
  [![Build](https://img.shields.io/badge/build-WASM%20%2B%20C%2B%2B-orange.svg)]()
  
  *Index questions, extract code, and visualize your logic flow across ChatGPT, Claude, and Gemini.*

</div>

---

Dendrite is a powerful, local-first browser extension designed for power users who have long, complex, and branching conversations with Large Language Models. Instead of endlessly scrolling through a single thread to find that one code snippet or follow-up question, Dendrite extracts and organizes your chat into a clean, searchable, and navigable sidebar index, complete with a **Logic Map** of your entire thought process.

## <img src="https://api.iconify.design/lucide:list.svg?color=white" width="24" height="24" align="absmiddle" /> Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [The Logic Map (WASM)](#the-logic-map-wasm)
- [Quick Start (Run Locally)](#quick-start-run-locally)
- [Build Details](#build-details)
- [Contributing](#contributing)

---

## <img src="https://api.iconify.design/lucide:sparkles.svg?color=white" width="24" height="24" align="absmiddle" /> Features

- <img src="https://api.iconify.design/lucide:globe.svg?color=white" width="16" height="16" align="absmiddle" /> **Cross-Platform Support**: Works seamlessly on ChatGPT (`chatgpt.com`), Claude (`claude.ai`), and Google Gemini (`gemini.google.com`).
- <img src="https://api.iconify.design/lucide:scan-search.svg?color=white" width="16" height="16" align="absmiddle" /> **Intelligent Scraping**: Automatically extracts and categorizes:
  - **Questions**: Follow your prompts and follow-up threads.
  - **Code Blocks**: Auto-detects programming languages and extracts headers/functions for easy copying.
  - **Links**: Aggregates all external URLs referenced in the chat.
  - **Artifacts**: Identifies uploaded documents (PDF, DOCX) and generated images.
- <img src="https://api.iconify.design/lucide:git-branch.svg?color=white" width="16" height="16" align="absmiddle" /> **Interactive Logic Map**: Visualizes your conversation as a branching dendrogram (tree) so you can easily see follow-up paths and alternate prompt branches.
- <img src="https://api.iconify.design/lucide:save.svg?color=white" width="16" height="16" align="absmiddle" /> **Context Export**: One-click export of your conversation context into a polished `Dev-Doc.md` or `Context-README.md` file for easy archival and sharing.
- <img src="https://api.iconify.design/lucide:zap.svg?color=white" width="16" height="16" align="absmiddle" /> **Lightning Fast**: Built with a WebAssembly (WASM) layout engine compiled from C++ for instantaneous map rendering—even on conversations with hundreds of nodes.

---

## <img src="https://api.iconify.design/lucide:settings.svg?color=white" width="24" height="24" align="absmiddle" /> How It Works

Dendrite operates entirely within your browser for maximum privacy. It uses highly-optimized Content Scripts to analyze the DOM of the active LLM platform without relying on external APIs.

1. **Observer & Scraper**: As you chat, `observer.js` listens for changes in the DOM. When the LLM responds, `scraper.js` analyzes the new elements, extracting the raw text, images, code syntax, and inferred context.
2. **Logic Flow Engine**: Using a unified heuristic, Dendrite determines if a question is a brand new topic or a *follow-up* to a previous question (`depth > 0`), constructing a logical parent-child relationship.
3. **Unified Side Panel**: The extension's side panel (accessible via the extension icon) presents a tabbed, searchable UI where you can instantly filter through all extracted entities. Clicking an item automatically scrolls the chat window to the exact location.

---

## <img src="https://api.iconify.design/lucide:network.svg?color=white" width="24" height="24" align="absmiddle" /> The Logic Map (WASM)

To handle massive, branching conversations smoothly, Dendrite leverages a custom WebAssembly tree-rendering engine (`tree_engine.wasm`). 

- The engine calculates a recursive dendrogram layout algorithm in **O(n) time** inside C++.
- The JS bridge (`map.js`) sends node IDs to WASM, which computes precise `(x, y)` coordinates.
- An interactive SVG is rendered in the panel, allowing you to highlight ancestor chains, view tooltips, and jump between distinct thought branches effortlessly.

---

## <img src="https://api.iconify.design/lucide:rocket.svg?color=white" width="24" height="24" align="absmiddle" /> Quick Start (Run Locally)

Because Dendrite is built with Vanilla JavaScript, HTML, CSS, and pre-compiled WASM, there are **no heavy `node_modules` or build steps required** to run it.

### Prerequisites
- A Chromium-based browser (Google Chrome, Brave, Arc, Edge).

### Installation Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/dendrite.git
   cd dendrite
   ```

2. **Open Extensions Dashboard**
   - In Chrome/Brave, go to the URL bar and type: `chrome://extensions/`
   - Enable **"Developer mode"** (toggle in the top right corner).

3. **Load the Extension**
   - Click the **"Load unpacked"** button in the top left.
   - Select the `dendrite` folder that you just cloned.

4. **Activate Dendrite**
   - Open a chat on ChatGPT, Claude, or Gemini.
   - Click the Dendrite icon in your extensions toolbar to open the Side Panel.
   - Chat normally—Dendrite will auto-index the page!

---

## <img src="https://api.iconify.design/lucide:package.svg?color=white" width="24" height="24" align="absmiddle" /> Build Details

> **Note:** You only need to follow these steps if you are modifying the C++ source code for the Logic Map engine. For standard extension usage or UI modification, no build step is required!

If you wish to modify the map's layout algorithm (`wasm/tree_engine.cpp`), you must recompile the WebAssembly binary using Emscripten.

1. **Install Emscripten (emsdk)**
   Follow the [official Emscripten installation guide](https://emscripten.org/docs/getting_started/downloads.html).

2. **Compile**
   ```bash
   # Source the Emscripten environment
   source /path/to/emsdk/emsdk_env.sh
   
   # Run the build script
   bash wasm/build.sh
   ```
   This will output an optimized `tree_engine.wasm` and JS glue code into the `panel/` directory.

---

## <img src="https://api.iconify.design/lucide:users.svg?color=white" width="24" height="24" align="absmiddle" /> Contributing

Contributions are highly welcome! To contribute:
1. Fork the repo
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

<div align="center">
  <i>Built for the Neural Navigators of the Web.</i>
</div>
