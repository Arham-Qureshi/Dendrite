'use strict';
// manages the whole extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.error('[Dendrite] sidePanel setup failed:', err));

// Add context menu for "Ask LLM" (reply-> claude, ask gpt->chatGPT, ask gemini -> Gemini)
// always a follow up!
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-dendrite',
    title: 'Ask Dendrite (LLM)',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-dendrite' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'DENDRITE_ASK_SELECTION',
      text: info.selectionText
    });
  }
});

// no need refresh browser, we have dedicated button in sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DENDRITE_UPDATE') {
    return false;
  }

  // when refershed it will check and inject the elements
  if (message.action === 'DENDRITE_INJECT') {
    const tabId = message.tabId;
    if (!tabId) { sendResponse({ success: false }); return true; }

    chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'content/platforms.js',
        'content/scraper.js',
        'content/observer.js',
        'content/navigator.js',
        'content/main.js',
      ],
    }).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      console.warn('[Dendrite] Script injection failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  }

  return false;
});

//triggers when tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    chrome.runtime.sendMessage({
      action: 'DENDRITE_TAB_CHANGED',
      tabId: activeInfo.tabId,
      url: tab.url || '',
    }).catch(() => { });
  } catch {
  }
});

// single page application navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    chrome.runtime.sendMessage({
      action: 'DENDRITE_TAB_CHANGED',
      tabId,
      url: changeInfo.url || _tab.url || '',
    }).catch(() => { });
  }
});