'use strict';

window.Dendrite = window.Dendrite || {};

window.Dendrite.Platforms = (() => {

  const REGISTRY = {

    chatgpt: {
      hostPattern: /chatgpt\.com|chat\.openai\.com/,
      displayName: 'ChatGPT',
      selectors: {
        chatContainer: 'main',
        userMessage: '[data-message-author-role="user"]',
        assistantMessage: '[data-message-author-role="assistant"]',
        codeBlock: 'pre code',
        link: 'a[href^="http"]',
        scrollContainer: '[class*="react-scroll-to-bottom"], main',
      },
      getMessageText(el) {
        const textEl = el.querySelector('.whitespace-pre-wrap, .markdown')
          || el;
        return textEl.innerText.trim();
      },
    },

    claude: {
      hostPattern: /claude\.ai/,
      displayName: 'Claude',
      selectors: {
        chatContainer: '[class*="conversation"], main',
        userMessage: '[data-testid="user-message"], .font-user-message',
        assistantMessage: '[data-testid="assistant-message"]',
        codeBlock: 'pre code, .code-block code',
        link: 'a[href^="http"]',
        scrollContainer: '[class*="scroll"], main',
      },
      getMessageText(el) {
        return el.innerText.trim();
      },
    },

    gemini: {
      hostPattern: /gemini\.google\.com/,
      displayName: 'Gemini',
      selectors: {
        chatContainer: 'main',
        userMessage: '.query-text, .user-query, [data-message-author="user"]',
        assistantMessage: '.response-container, .model-response',
        codeBlock: 'pre code, .code-block code',
        link: 'a[href^="http"]',
        scrollContainer: 'main',
      },
      getMessageText(el) {
        return el.innerText.trim().replace(/^you said\s*/i, '');
      },
    },
  };

  const GENERIC_FALLBACK = {
    hostPattern: /.*/,
    displayName: 'Unknown',
    selectors: {
      chatContainer: 'main, [role="main"], body',
      userMessage: '[data-role="user"], [class*="user-message"]',
      assistantMessage: '[data-role="assistant"], [class*="assistant"]',
      codeBlock: 'pre code',
      link: 'a[href^="http"]',
      scrollContainer: 'body',
    },
    getMessageText(el) {
      return el.innerText.trim();
    },
  };

  return {

    resolve() {
      const host = location.hostname;

      for (const [id, config] of Object.entries(REGISTRY)) {
        if (config.hostPattern.test(host)) {
          console.log(`[Dendrite] Platform resolved: ${config.displayName}`);
          return Object.freeze({ ...config, id });
        }
      }

      console.warn('[Dendrite] No matching platform — using generic selectors');
      return Object.freeze({ ...GENERIC_FALLBACK, id: 'generic' });
    },
  };

})();
