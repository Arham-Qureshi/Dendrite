'use strict';

/**
 * @namespace Dendrite.Scraper
 */

window.Dendrite = window.Dendrite || {};

window.Dendrite.Scraper = (() => {

  let anchorSeq = 0;

  const PREVIEW_LEN = 80;

  const MAX_NODES = 200;

  /**
   * @param {HTMLElement} el     - DOM element to anchor
   * @param {string}      prefix - Short type prefix (q / c / l)
   * @returns {string} The anchor ID
   */
  function ensureAnchor(el, prefix) {
    if (el.dataset.dendriteId) return el.dataset.dendriteId;

    const id = `dn-${prefix}-${anchorSeq++}`;
    el.dataset.dendriteId = id;

    if (!el.id) el.id = id;

    return id;
  }

  /**
   */
  function truncate(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length <= PREVIEW_LEN
      ? clean
      : clean.slice(0, PREVIEW_LEN) + '…';
  }

  /**
   */
  function safeQueryAll(root, selector) {
    try {
      return root.querySelectorAll(selector);
    } catch {
      console.warn(`[Dendrite] Invalid selector: ${selector}`);
      return [];
    }
  }

  function scrapeQuestions(platform) {
    const els = safeQueryAll(document, platform.selectors.userMessage);
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
        timestamp: Date.now(),
      });
    });

    return nodes.slice(0, MAX_NODES);
  }

  function scrapeCodeBlocks(platform) {
    const container = document.querySelector(platform.selectors.chatContainer)
      || document.body;
    const els = safeQueryAll(container, platform.selectors.codeBlock);
    const nodes = [];

    els.forEach((el, i) => {
      const code = el.textContent.trim();
      if (!code || code.length < 4) return; // skip trivial inline code

      const langClass = Array.from(el.classList)
        .find(c => c.startsWith('language-') || c.startsWith('hljs-'));
      const language = langClass
        ? langClass.replace(/^(language-|hljs-)/, '')
        : detectLanguageHeuristic(code);

      nodes.push({
        id: ensureAnchor(el.closest('pre') || el, 'c'),
        type: 'code',
        index: i + 1,
        preview: truncate(code),
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

  return {
    /**
     * @param {Object} platform - Resolved platform config
     * @returns {{ questions: Array, codeBlocks: Array, links: Array }}
     */
    scrape(platform) {
      return {
        questions: scrapeQuestions(platform),
        codeBlocks: scrapeCodeBlocks(platform),
        links: scrapeLinks(platform),
      };
    },
  };

})();