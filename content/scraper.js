'use strict';
// actual scrapper engine
//becuase we dont have money for an AI(summary)so we use this.
window.Dendrite = window.Dendrite || {};

window.Dendrite.Scraper = (() => {

  let anchorSeq = 0;

  const PREVIEW_LEN = 80;

  const MAX_NODES = 200;


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

  return {

    scrape(platform) {
      return {
        questions: scrapeQuestions(platform),
        codeBlocks: scrapeCodeBlocks(platform),
        links: scrapeLinks(platform),
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