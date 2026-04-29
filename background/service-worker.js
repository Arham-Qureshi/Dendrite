'use strict';
// manages the whole extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.error('[Dendrite] sidePanel setup failed:', err));

// auto updation of side panel when tab changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DENDRITE_UPDATE') {
    return false;
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    chrome.runtime.sendMessage({
      action: 'DENDRITE_TAB_CHANGED',
      tabId,
      url: changeInfo.url || '',
    }).catch(() => { });
  }
});