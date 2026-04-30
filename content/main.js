'use strict';
// this handles the scrapped data
(function () {
  'use strict';

  const { Platforms, Scraper, Observer, Navigator } = window.Dendrite;

  let initialized = false;
  let platform = null;
  let lastKnownUrl = location.href; //through this we can detect new chats within tab it keeps loc 
  let urlPollTimer = null;

  //using regex to detect whether the next msg is a follow up or not,
  // yes, harcoded
  const PRONOUNS = /\b(it|this|that|them|those|above|previous|mentioned|it's|its|they|he|she)\b/i;
  const CONTINUATIONS = /^(why|how|and|but|so|then|more|elaborate|clarify|continue|tell me more|give me an example)/i;
  const QUESTION_STARTERS = /^(what|why|how|can you|could you|explain|tell me|show me|give me|what's|where|when)/i;

  function isDynamicFollowUp(text, prevText) {
    const clean = text.toLowerCase().trim();
    const words = clean.split(/\s+/);

    // shows that pronouns are mostly follow ups
    if (PRONOUNS.test(clean)) return true;

    // assumes continuation words are follow ups
    if (CONTINUATIONS.test(clean) && words.length < 10) return true;

    // checks if it starts with a question word, check what follows
    const match = clean.match(QUESTION_STARTERS);
    if (match) {
      const starter = match[0];
      const remainder = clean.slice(starter.length).trim();

      // SOME BIG BRAIN LOGIC HERE 

      // if nothing follows or only pronouns/filler follow, it's a follow-up
      // e.g., "Explain?", "What is it?", "How?"
      if (!remainder || remainder.length < 15 || PRONOUNS.test(remainder)) {
        // But if it contains a specific noun that's not a pronoun, it might be a new question
        //filter common words (hit and try by replacing the words below.)
        const potentialTopic = remainder.replace(/\b(is|are|was|were|a|an|the|about|of|to|for|with|in|on|at|by|from)\b/g, '').trim();
        if (potentialTopic.length > 2 && !PRONOUNS.test(potentialTopic)) {
          return false; // if nothing then its beginning (i m a philosopher.)
        }
        return true;
      }
      return false; // lengthy question always a new topic.
    }

    //assumes short fragments without subjects are follow ups.
    if (words.length <= 3 && !/^[A-Z]/.test(text)) return true;

    return false;
  }

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

      if (isDynamicFollowUp(cur.fullText, prev.fullText)) {
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
        artifacts: data.artifacts || [],
        platform: platform.id,
        platformName: platform.displayName,
        url: location.href,
        timestamp: Date.now(),
      },
    }).catch(() => {
    });
  }

  // same tab, different chat observer
  function reinitForNewChat() {
    Observer.stop();

    // scraps new chat from same tabs
    if (window.Dendrite.Scraper._resetAnchors) {
      window.Dendrite.Scraper._resetAnchors();
    }

    lastKnownUrl = location.href;

    // delay for full rendering
    setTimeout(() => {
      const data = performScrape();
      broadcastUpdate(data);

      Observer.start(platform, () => {
        const fresh = performScrape();
        broadcastUpdate(fresh);
      });

      console.log(
        `[Dendrite] Re-synced for new chat — ${data.questions.length} questions, ` +
        `${data.codeBlocks.length} code blocks, ${data.links.length} links, ${(data.artifacts || []).length} artifacts`
      );
    }, 800);
  }

  // same tab (SPA) observer
  function startUrlWatcher() {
    if (urlPollTimer) clearInterval(urlPollTimer);

    urlPollTimer = setInterval(() => {
      if (location.href !== lastKnownUrl) {
        console.log(`[Dendrite] URL change detected: ${lastKnownUrl} → ${location.href}`);
        reinitForNewChat();
      }
    }, 800);
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
            artifacts: data.artifacts || [],
            platform: platform ? platform.id : null,
            platformName: platform ? platform.displayName : '',
            url: location.href,
          },
        });
        return true;
      }

      // force refresh (manually refreshed)
      case 'DENDRITE_FORCE_REFRESH': {
        if (!initialized) {
          init();
        } else {
          reinitForNewChat();
        }
        // respond immediately(re scrape)
        sendResponse({ success: true });
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
          url: location.href,
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
    lastKnownUrl = location.href;
    console.log(`[Dendrite] Bootstrapping on ${platform.displayName} (${location.hostname})`);

    const data = performScrape();
    broadcastUpdate(data);

    // tick checks for new user mssgs
    Observer.start(platform, () => {
      const fresh = performScrape();
      broadcastUpdate(fresh);
    });

    // (chat switching)
    startUrlWatcher();

    console.log(
      `[Dendrite] Ready — ${data.questions.length} questions, ` +
      `${data.codeBlocks.length} code blocks, ${data.links.length} links, ${(data.artifacts || []).length} artifacts indexed`
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