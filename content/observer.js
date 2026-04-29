'use strict';

// observes the chat for DOM changes
window.Dendrite = window.Dendrite || {};

window.Dendrite.Observer = (() => {
  let observer = null;
  let debounceTimer = null;
  let onChangeCallback = null;
  const DEBOUNCE_MS = 600;

  function findTarget(platform) {
    const candidates = [
      platform.selectors.scrollContainer,
      platform.selectors.chatContainer,
      'main',
      '[role="main"]',
    ];

    for (const sel of candidates) {
      if (!sel) continue;
      for (const s of sel.split(',')) {
        const el = document.querySelector(s.trim());
        if (el && el !== document.documentElement) return el;
      }
    }

    return document.body;
  }

  // debouncing, so we dont collect half rendered mssg.
  function handleMutations(mutations) {
    const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
    if (!hasNewNodes) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (onChangeCallback) onChangeCallback();
    }, DEBOUNCE_MS);
  }

  return {
    // it trigger the DOM update function
    start(platform, onChange) {
      this.stop();

      onChangeCallback = onChange;
      const target = findTarget(platform);

      observer = new MutationObserver(handleMutations);
      observer.observe(target, {
        childList: true,
        subtree: true,
      });

      console.log('[Dendrite] Observer attached to', target.tagName || 'body');
    },

    stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      clearTimeout(debounceTimer);
      debounceTimer = null;
    },
  };

})();