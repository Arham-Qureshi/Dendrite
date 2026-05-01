# 🧠 Architecture: Extension Core (Background & Content Scripts)

This document outlines the core operational loop of Dendrite—how it hooks into the browser, intercepts DOM updates from LLM platforms, and extracts valuable contextual data.

## 🕸️ High-Level Component Flow

```mermaid
flowchart TD
  Browser["Browser (Active Tab)"]
  LLM["LLM Platform (ChatGPT/Claude/Gemini)"]
  Panel["Panel UI"]

  subgraph Background["background/service-worker.js"]
    SW["Service Worker"]
    CM["Context Menus"]
    TI["Tab Injector"]
  end

  subgraph Content["content/ (Injected)"]
    Obs["observer.js<br/>(MutationObserver)"]
    Main["main.js<br/>(Logic Flow Engine)"]
    Scrape["scraper.js<br/>(Entity Extractor)"]
    Nav["navigator.js<br/>(Scroll Anchors)"]
    Plat["platforms.js<br/>(CSS Selectors)"]
  end

  Browser -->|Navigation / Tab Switch| SW
  SW -->|Injects if missing| Obs
  LLM -->|DOM Updates (streaming text)| Obs
  Obs -->|Debounced triggers| Main
  Main -->|Queries DOM| Scrape
  Plat -->|Provides rules| Scrape
  Scrape -->|Returns nodes| Main
  Main -->|chrome.runtime.sendMessage| Panel
```

## ⚙️ The Background Service Worker (`background/service-worker.js`)
The Service Worker acts as the central router for the extension. It is responsible for:
1. **Side Panel Initialization:** Binds the panel to open when the extension icon is clicked.
2. **Context Menu:** Installs the "Ask Dendrite" right-click option, allowing users to select text and trigger a follow-up explicitly.
3. **Tab Monitoring:** Listens for `onActivated` and `onUpdated` events. Since LLM interfaces are Single Page Applications (SPAs), traditional page reloads don't happen. The service worker notifies the extension when the URL changes so it can re-initialize parsing.
4. **Script Injection:** If the panel asks for a refresh but the content scripts aren't present (e.g., after an extension update or browser restart), the service worker dynamically injects the `content/` scripts using `chrome.scripting`.

## 📄 The Content Script Engine

The heavy lifting happens entirely within the active LLM tab.

### `platforms.js`
A configuration dictionary that provides CSS selectors for different AI models (ChatGPT, Claude, Gemini). It ensures the scraper knows exactly what a "user message" or "assistant message" looks like.

### `observer.js`
A highly optimized `MutationObserver` that watches the chat container. Because LLMs stream responses token-by-token, `observer.js` debounces these updates so that the parsing engine doesn't freeze the browser.

### `scraper.js`
The core parser. It doesn't rely on APIs; it purely reads the DOM.
- Extracts `questions` and assigns them sequential indices.
- Scrapes `codeBlocks`, using custom heuristics to extract file names from comments or preceding text to generate smart headers instead of generic ones.
- Extracts `links` and `artifacts` (images, PDFs, SVGs).
- Applies `data-dendrite-id` anchors directly to the DOM elements so we can scroll back to them later.

### `main.js` (The Logic Flow)
The orchestrator. It receives raw arrays from `scraper.js` and builds the contextual tree:
- Re-calculates `parentId` and `depth` for questions to determine if a prompt is a new thought or a follow-up.
- Assembles the final state payload and broadcasts it to the Panel via `chrome.runtime.sendMessage`.

### `navigator.js`
A small utility that listens for requests from the Panel to scroll the actual window to specific `data-dendrite-id` elements using smooth scrolling behavior.
