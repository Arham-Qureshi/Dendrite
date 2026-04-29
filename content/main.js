'use strict';
// this handles the scrapped data
(function () {
  'use strict';

  const { Platforms, Scraper, Observer, Navigator } = window.Dendrite;

  // Builds a multithreaded tree of questions (async)
  function applyLogicFlow(questions) {
    if (questions.length <= 1) {
      if (questions.length === 1) {
        questions[0].parentId = null;
        questions[0].depth = 0;
      }
      return questions;
    }

    questions[0].parentId = null;
    questions[0].depth = 0;

    for (let i = 1; i < questions.length; i++) {
      const cur = questions[i];
      const prev = questions[i - 1];
      const text = cur.fullText.toLowerCase().trim();

      const isShort = text.length < 120;
      const isVeryShort = text.length < 40;
      const matchesPattern = FOLLOW_UP_RX.some(rx => rx.test(text));

      if (isVeryShort || (isShort && matchesPattern)) {
        cur.parentId = prev.id;
        cur.depth = Math.min((prev.depth || 0) + 1, 3);
      } else {
        cur.parentId = null;
        cur.depth = 0;
      }
    }

    return questions;
  }

  // actual scrapping and handling starts here
  function performScrape() {
    const data = Scraper.scrape(platform);
    data.questions = applyLogicFlow(data.questions);
    return data;
  }

  function broadcastUpdate(data) {
    chrome.runtime.sendMessage({
      action: 'DENDRITE_UPDATE',
      payload: {
        questions: data.questions,
        codeBlocks: data.codeBlocks,
        links: data.links,
        platform: platform.id,
        platformName: platform.displayName,
        url: location.href,
        timestamp: Date.now(),
      },
    }).catch(() => {
    });
  }

  function handleMessage(message, _sender, sendResponse) {
    switch (message.action) {
      case 'DENDRITE_REFRESH': {
        if (!initialized) {
          init();
        }
        const data = performScrape();
        sendResponse({
          success: true,
          payload: {
            questions: data.questions,
            codeBlocks: data.codeBlocks,
            links: data.links,
            platform: platform ? platform.id : null,
            platformName: platform ? platform.displayName : '',
          },
        });
        return true;
      }

      case 'DENDRITE_SCROLL_TO': {
        if (!initialized) return false;
        const found = Navigator.scrollTo(message.anchorId);
        sendResponse({ success: found });
        return true;
      }

      case 'DENDRITE_PING': {
        sendResponse({
          success: true,
          platform: platform ? platform.id : null,
          platformName: platform ? platform.displayName : '',
        });
        return true;
      }

      default:
        return false;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    platform = Platforms.resolve();
    console.log(`[Dendrite] Bootstrapping on ${platform.displayName} (${location.hostname})`);

    const data = performScrape();
    broadcastUpdate(data);

    // tick checks for new user mssgs
    Observer.start(platform, () => {
      const fresh = performScrape();
      broadcastUpdate(fresh);
    });

    console.log(
      `[Dendrite] Ready — ${data.questions.length} questions, ` +
      `${data.codeBlocks.length} code blocks, ${data.links.length} links indexed`
    );
  }

  // scraaping happens after 600ms delay,but msshHandler runs immidiately,because it can handle the request even if the scraaping is not done yet
  chrome.runtime.onMessage.addListener(handleMessage);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }
})();