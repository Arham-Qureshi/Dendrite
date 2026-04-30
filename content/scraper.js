'use strict';
// actual scrapper engine
//becuase we dont have money for an AI(summary)so we use this.
window.Dendrite = window.Dendrite || {};

window.Dendrite.Scraper = (() => {

  let anchorSeq = 0;

  const PREVIEW_LEN = 80;

  const MAX_NODES = 200;
  const MAX_RESPONSE_IMAGES = 8;
  const MAX_RESPONSE_LINKS = 8;
  const MAX_RESPONSE_SNIPPETS = 8;


  function ensureAnchor(el, prefix) {
    if (el.dataset.dendriteId) return el.dataset.dendriteId;

    const id = `dn-${prefix}-${anchorSeq++}`;
    el.dataset.dendriteId = id;

    if (!el.id) el.id = id;

    return id;
  }


  function truncate(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length <= PREVIEW_LEN
      ? clean
      : clean.slice(0, PREVIEW_LEN) + '…';
  }


  function safeQueryAll(root, selector) {
    try {
      return root.querySelectorAll(selector);
    } catch {
      console.warn(`[Dendrite] Invalid selector: ${selector}`);
      return [];
    }
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u200b/g, '')
      .trim();
  }

  function truncateHard(text, max) {
    const clean = cleanText(text).replace(/\s+/g, ' ');
    if (clean.length <= max) return clean;
    return clean.slice(0, max) + '…';
  }

  function pushUnique(arr, seen, value) {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    arr.push(value);
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url || '';
    }
  }

  function buildMessageOrderMap(platform) {
    const container = document.querySelector(platform.selectors.chatContainer) || document.body;
    const combinedSelector = `${platform.selectors.userMessage}, ${platform.selectors.assistantMessage}`;
    const all = Array.from(safeQueryAll(container, combinedSelector));
    const dedup = [];
    const seen = new Set();

    all.forEach((el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      dedup.push(el);
    });

    const map = new WeakMap();
    dedup.forEach((el, i) => map.set(el, i + 1));
    return map;
  }

  function extractResponseImages(el) {
    const urls = [];
    const seen = new Set();
    const imgs = safeQueryAll(el, 'img');

    imgs.forEach((img) => {
      if (urls.length >= MAX_RESPONSE_IMAGES) return;
      const raw = img.currentSrc || img.src || img.dataset.src || img.dataset.original || '';
      if (!raw) return;
      if (raw.startsWith('data:') && raw.length < 500) return;
      if (/avatar|icon|emoji|logo|favicon/i.test(raw)) return;
      if (/avatar|icon|emoji|logo|favicon/i.test(img.className)) return;
      const href = normalizeUrl(raw);
      pushUnique(urls, seen, href);
    });

    return urls;
  }

  function extractResponseLinks(el) {
    const out = [];
    const seen = new Set();
    const anchors = safeQueryAll(el, 'a[href]');

    anchors.forEach((a) => {
      if (out.length >= MAX_RESPONSE_LINKS) return;
      const href = normalizeUrl(a.href || '');
      if (!href || !/^https?:\/\//i.test(href)) return;
      pushUnique(out, seen, href);
    });

    return out;
  }

  function extractResponseSnippets(el, rawText) {
    const snippets = [];
    const seen = new Set();

    // File cards / artifact-like response blocks (README.md, docs, etc.)
    const fileish = safeQueryAll(el, '[data-testid*="file"], [class*="file"], [class*="attachment"], [class*="artifact"]');
    fileish.forEach((node) => {
      if (snippets.length >= MAX_RESPONSE_SNIPPETS) return;
      const txt = truncateHard(node.textContent || '', 220);
      if (txt.length < 3) return;
      pushUnique(snippets, seen, txt);
    });

    // Structured text blocks for non-plain responses.
    const blocks = safeQueryAll(el, 'h1, h2, h3, h4, p, li, blockquote, pre, code');
    blocks.forEach((node) => {
      if (snippets.length >= MAX_RESPONSE_SNIPPETS) return;
      const txt = truncateHard(node.textContent || '', 220);
      if (txt.length < 12) return;
      pushUnique(snippets, seen, txt);
    });

    // If we already have raw text, keep only snippets that add novel clues.
    if (rawText) {
      const rawCompact = truncateHard(rawText, 2000).toLowerCase();
      return snippets.filter(s => !rawCompact.includes(s.toLowerCase())).slice(0, MAX_RESPONSE_SNIPPETS);
    }

    return snippets.slice(0, MAX_RESPONSE_SNIPPETS);
  }

  function scrapeQuestions(platform, orderMap) {
    const container = document.querySelector(platform.selectors.chatContainer) || document.body;
    const els = safeQueryAll(container, platform.selectors.userMessage);
    const nodes = [];

    els.forEach((el, i) => {
      const raw = platform.getMessageText(el);
      if (!raw) return;

      nodes.push({
        id: ensureAnchor(el, 'q'),
        type: 'question',
        index: i + 1,
        preview: truncate(raw),
        fullText: raw,
        parentId: null,   // assigned later by LogicFlow
        depth: 0,
        domOrder: orderMap.get(el) || (i + 1),
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  // scrapes the llms responses and make markdown file for big leagues
  function scrapeResponses(platform, orderMap) {
    const container = document.querySelector(platform.selectors.chatContainer) || document.body;
    const els = safeQueryAll(container, platform.selectors.assistantMessage);
    const nodes = [];

    els.forEach((el, i) => {
      const raw = cleanText(platform.getMessageText(el));
      const images = extractResponseImages(el);
      const responseLinks = extractResponseLinks(el);
      const snippets = extractResponseSnippets(el, raw);

      if (!raw && !images.length && !responseLinks.length && !snippets.length) return;

      const parts = [];
      if (raw) parts.push(raw);
      if (!raw && snippets.length) parts.push(snippets.join('\n'));
      if (images.length) parts.push(`Images:\n${images.join('\n')}`);
      if (responseLinks.length) parts.push(`Links:\n${responseLinks.join('\n')}`);
      const fullText = parts.join('\n\n').trim();

      const previewSeed = raw || snippets[0] || (images.length ? 'Image response' : 'Assistant response');
      let responseKind = 'text';
      if (!raw && images.length) responseKind = 'image';
      if (!raw && !images.length && snippets.length) responseKind = 'snippet';
      if (!raw && !images.length && !snippets.length && responseLinks.length) responseKind = 'link';

      nodes.push({
        id: ensureAnchor(el, 'r'),
        type: 'response',
        index: i + 1,
        preview: truncate(previewSeed),
        fullText,
        responseKind,
        images,
        responseLinks,
        snippets,
        domOrder: orderMap.get(el) || (i + 1),
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  function extractCodeHeading(el, code, previousQuestionText) {
    //Look for a filename comment
    const firstLines = code.split('\n').slice(0, 3);
    for (const line of firstLines) {
      const match = line.trim().match(/^(?:\/\/|#|<!--|\/\*)\s*([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)\s*(?:-->|\*\/)?$/);
      if (match) return `File: ${match[1]}`;
    }

    //Look for the immediate preceding text 
    const pre = el.closest('pre');
    if (pre && pre.previousElementSibling) {
      const prevEl = pre.previousElementSibling;
      if (prevEl.tagName === 'P' || prevEl.tagName === 'DIV' || prevEl.tagName === 'H3' || prevEl.tagName === 'H4') {
        const text = prevEl.textContent.trim();
        if (text.endsWith(':') && text.length < 120) {
          return truncate(text.replace(/:$/, ''));
        }
      }
    }

    // Extract main functions and make it title
    const entityMatch = code.match(/(?:function|class|def|struct|interface|enum)\s+([a-zA-Z0-9_]+)/);
    if (entityMatch) {
      return entityMatch[0];
    }


    const varMatch = code.match(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>|function)/);
    if (varMatch) {
      return `${varMatch[1]} (Function)`;
    }

    // if nothing fallback to the user's previous question
    if (previousQuestionText) {
      return `Re: ${previousQuestionText}`;
    }

    // super fallback first line code 
    const firstNonEmpty = firstLines.find(l => l.trim().length > 0);
    return firstNonEmpty ? truncate(firstNonEmpty) : 'Code snippet';
  }

  function scrapeCodeBlocks(platform) {
    const container = document.querySelector(platform.selectors.chatContainer)
      || document.body;
    const els = safeQueryAll(container, platform.selectors.codeBlock);

    // Get all user messages to find the preceding question for each code block
    const questionEls = Array.from(safeQueryAll(document, platform.selectors.userMessage)).map(qEl => ({
      el: qEl,
      text: truncate(platform.getMessageText(qEl))
    }));

    const nodes = [];

    els.forEach((el, i) => {
      const code = el.textContent.trim();
      if (!code || code.length < 4) return; // skip trivial inline code

      const langClass = Array.from(el.classList)
        .find(c => c.startsWith('language-') || c.startsWith('hljs-'));
      const language = langClass
        ? langClass.replace(/^(language-|hljs-)/, '')
        : detectLanguageHeuristic(code);

      // preceding question text
      let previousQuestionText = null;
      for (let j = questionEls.length - 1; j >= 0; j--) {
        if (questionEls[j].el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          previousQuestionText = questionEls[j].text;
          break;
        }
      }

      const heading = extractCodeHeading(el, code, previousQuestionText);

      nodes.push({
        id: ensureAnchor(el.closest('pre') || el, 'c'),
        type: 'code',
        index: i + 1,
        preview: heading,
        fullText: code,
        language,
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  function scrapeLinks(platform) {
    const container = document.querySelector(platform.selectors.chatContainer)
      || document.body;
    const els = safeQueryAll(container, platform.selectors.link);
    const seen = new Set();
    const nodes = [];

    els.forEach((el, i) => {
      const href = el.href;
      if (!href || seen.has(href)) return;

      if (href.startsWith('chrome') || href.startsWith('about:')) return;

      seen.add(href);

      const label = el.textContent.trim() || new URL(href).hostname;

      nodes.push({
        id: ensureAnchor(el, 'l'),
        type: 'link',
        index: nodes.length + 1,
        preview: truncate(label),
        href,
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  function detectLanguageHeuristic(code) {
    const first = code.slice(0, 200).toLowerCase();
    if (first.includes('def ') || first.includes('import ')) return 'python';
    if (first.includes('function') || first.includes('=>')) return 'javascript';
    if (first.includes('#include') || first.includes('int main')) return 'c';
    if (first.includes('<!doctype') || first.includes('<html')) return 'html';
    if (first.includes('{') && first.includes(':')) return 'json';
    if (first.includes('select ') || first.includes('from ')) return 'sql';
    return 'text';
  }

  //used for scraping (img,docx,pdf etc.)
  function scrapeArtifacts(platform) {
    const container = document.querySelector(platform.selectors.chatContainer)
      || document.body;

    const DOC_EXT = /\.(pdf|docx?|xlsx?|csv|pptx?|txt|rtf|odt)$/i;
    const IMG_MIN_SIZE = 40;

    const nodes = [];
    const seen = new Set();

    const imgs = safeQueryAll(container, 'img');
    imgs.forEach((img) => {
      const src = img.src || img.dataset.src || '';
      if (!src || seen.has(src)) return;
      if (img.naturalWidth && img.naturalWidth < IMG_MIN_SIZE) return;
      if (img.naturalHeight && img.naturalHeight < IMG_MIN_SIZE) return;
      if (src.startsWith('data:') && src.length < 500) return;
      if (/avatar|icon|emoji|logo|favicon/i.test(src)) return;
      if (/avatar|icon|emoji|logo|favicon/i.test(img.className)) return;

      seen.add(src);

      const alt = img.alt || '';
      const label = alt || 'Image';

      nodes.push({
        id: ensureAnchor(img, 'a'),
        type: 'artifact',
        artifactType: 'image',
        index: nodes.length + 1,
        preview: truncate(label),
        href: src,
        timestamp: Date.now(),
      });
    });

    // scrapes doc links
    const anchors = safeQueryAll(container, 'a[href]');
    anchors.forEach((a) => {
      const href = a.href || '';
      if (!href || seen.has(href)) return;
      if (!DOC_EXT.test(href)) return;

      seen.add(href);

      const extMatch = href.match(DOC_EXT);
      const ext = extMatch ? extMatch[1].toUpperCase() : 'DOC';
      const label = a.textContent.trim() || `${ext} document`;

      nodes.push({
        id: ensureAnchor(a, 'a'),
        type: 'artifact',
        artifactType: ext.toLowerCase(),
        index: nodes.length + 1,
        preview: truncate(label),
        href,
        timestamp: Date.now(),
      });
    });

    const uploadEls = safeQueryAll(container, '[data-testid*="file"], [class*="attachment"], [class*="upload"], [class*="file-block"]');
    uploadEls.forEach((el) => {
      const link = el.querySelector('a[href]');
      const href = link ? link.href : '';
      if (href && seen.has(href)) return;

      const label = el.textContent.trim();
      if (!label || label.length < 2) return;

      const id = ensureAnchor(el, 'a');
      if (seen.has(id)) return;
      seen.add(id);
      if (href) seen.add(href);

      nodes.push({
        id,
        type: 'artifact',
        artifactType: 'file',
        index: nodes.length + 1,
        preview: truncate(label),
        href: href || '',
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  return {

    scrape(platform) {
      const orderMap = buildMessageOrderMap(platform);
      return {
        questions: scrapeQuestions(platform, orderMap),
        responses: scrapeResponses(platform, orderMap),
        codeBlocks: scrapeCodeBlocks(platform),
        links: scrapeLinks(platform),
        artifacts: scrapeArtifacts(platform),
      };
    },
    //reset ids and anchor when chat swiths.
    _resetAnchors() {
      document.querySelectorAll('[data-dendrite-id]').forEach(el => {
        delete el.dataset.dendriteId;
      });
      anchorSeq = 0;
    },
  };

})();
