'use strict';
(function () {
  const state = {
    questions: [],
    codeBlocks: [],
    links: [],
    artifacts: [],
    activeFilter: 'questions',
    searchQuery: '',
    platform: null,
    platformName: '',
    connected: false,
    activeTabId: null,
    lastUrl: '',  //store last URL to detect same tab but new chat
    refreshing: false,
  };
  //cahced DOM for later reference
  const $ = (id) => document.getElementById(id);

  const DOM = {
    list: $('node-list'),
    searchInput: $('search-input'),
    searchWrap: document.querySelector('.dn-search-wrap'),
    filterBar: $('filter-bar'),
    platformBadge: $('platform-badge'),
    statQuestions: $('stat-questions'),
    statCode: $('stat-code'),
    statLinks: $('stat-links'),
    statArtifacts: $('stat-artifacts'),
    refreshBtn: $('refresh-btn'),
    mapViewport: $('map-viewport'),
    mapTooltip: $('map-tooltip'),
    mapLegend: $('map-legend'),
    moreDropdown: $('more-dropdown'),
    moreToggle: $('more-toggle'),
    moreMenu: $('more-menu'),
  };

  async function init() {
    bindFilters();
    bindDropdown();
    bindSearch();
    bindRefreshButton();
    listenForMessages();

    // initialize WASM map engine
    if (typeof DendriteMap !== 'undefined' && DOM.mapViewport) {
      await DendriteMap.init(DOM.mapViewport, DOM.mapTooltip);
    }

    refreshFromActiveTab();
  }

  function ingestPayload(payload) {
    state.questions = payload.questions || [];
    state.codeBlocks = payload.codeBlocks || [];
    state.links = payload.links || [];
    state.artifacts = payload.artifacts || [];
    state.platform = payload.platform || null;
    state.platformName = payload.platformName || '';
    state.lastUrl = payload.url || state.lastUrl;
    state.connected = true;
    state.refreshing = false;

    updateStats();
    updateBadge();
    updateRefreshBtn();
    render();
  }
  //inject new elements if fails retyr.
  async function refreshFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { showDisconnected(); return; }

      state.activeTabId = tab.id;

      // first try
      chrome.tabs.sendMessage(tab.id, { action: 'DENDRITE_REFRESH' }, async (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          // content script not loaded — try injecting it
          await tryInjectAndRetry(tab.id);
          return;
        }
        ingestPayload(res.payload);
      });
    } catch {
      showDisconnected();
    }
  }

  // inject content scripts via service worker, then retry
  async function tryInjectAndRetry(tabId) {
    try {
      const injectRes = await chrome.runtime.sendMessage({
        action: 'DENDRITE_INJECT',
        tabId,
      });

      if (!injectRes?.success) {
        showDisconnected();
        return;
      }

      // wait for scripts to initialize
      await new Promise(r => setTimeout(r, 1200));

      chrome.tabs.sendMessage(tabId, { action: 'DENDRITE_REFRESH' }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          showDisconnected();
          return;
        }
        ingestPayload(res.payload);
      });
    } catch {
      showDisconnected();
    }
  }

  // force refresh(manual)
  async function forceRefreshChat() {
    if (state.refreshing) return;
    state.refreshing = true;
    updateRefreshBtn();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { state.refreshing = false; updateRefreshBtn(); showDisconnected(); return; }

      state.activeTabId = tab.id;

      chrome.tabs.sendMessage(tab.id, { action: 'DENDRITE_FORCE_REFRESH' }, async (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          await tryInjectAndRetry(tab.id);
          state.refreshing = false;
          updateRefreshBtn();
          return;
        }

        // avoiding the spamming of refresh
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'DENDRITE_REFRESH' }, (res2) => {
            if (res2?.success) ingestPayload(res2.payload);
            state.refreshing = false;
            updateRefreshBtn();
          });
        }, 1200);
      });
    } catch {
      state.refreshing = false;
      updateRefreshBtn();
      showDisconnected();
    }
  }

  function listenForMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'DENDRITE_UPDATE') {
        ingestPayload(msg.payload);
      }
      if (msg.action === 'DENDRITE_TAB_CHANGED') {
        setTimeout(refreshFromActiveTab, 300);
      }
    });
  }

  function bindFilters() {
    // Handle primary tab clicks (Questions, Code, Map)
    DOM.filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.dn-filter-btn:not(.dn-dropdown-toggle)');
      if (!btn || btn.dataset.filter === state.activeFilter) return;
      if (btn.closest('.dn-dropdown')) return;

      activateFilter(btn.dataset.filter);
      clearDropdownActive();
      closeDropdown();
    });
  }

  function bindDropdown() {
    if (DOM.moreToggle) {
      DOM.moreToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = DOM.moreDropdown.classList.toggle('open');
        DOM.moreToggle.setAttribute('aria-expanded', isOpen);
      });
    }

    //dropdown button handler.
    if (DOM.moreMenu) {
      DOM.moreMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dn-dropdown-item');
        if (!item) return;
        e.stopPropagation();

        activateFilter(item.dataset.filter);

        // Mark dropdown item as active, highlight "More" toggle
        DOM.moreMenu.querySelectorAll('.dn-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        DOM.moreToggle.classList.add('has-active');

        // Deactivate primary tabs
        DOM.filterBar.querySelectorAll('.dn-filter-btn:not(.dn-dropdown-toggle)').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });

        closeDropdown();
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (DOM.moreDropdown && !DOM.moreDropdown.contains(e.target)) {
        closeDropdown();
      }
    });
  }

  function activateFilter(filter) {
    // Deactivate all primary tabs
    DOM.filterBar.querySelectorAll('.dn-filter-btn:not(.dn-dropdown-toggle)').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });

    // If it's a primary tab, mark it active
    const primaryBtn = DOM.filterBar.querySelector(`.dn-filter-btn[data-filter="${filter}"]`);
    if (primaryBtn) {
      primaryBtn.classList.add('active');
      primaryBtn.setAttribute('aria-selected', 'true');
    }

    state.activeFilter = filter;

    const isMap = filter === 'map';
    DOM.list.style.display = isMap ? 'none' : '';
    DOM.mapViewport.classList.toggle('visible', isMap);
    DOM.mapLegend.style.display = isMap ? '' : 'none';

    if (DOM.searchWrap) DOM.searchWrap.style.display = isMap ? 'none' : '';

    render();
  }

  function clearDropdownActive() {
    if (DOM.moreMenu) {
      DOM.moreMenu.querySelectorAll('.dn-dropdown-item').forEach(i => i.classList.remove('active'));
    }
    if (DOM.moreToggle) {
      DOM.moreToggle.classList.remove('has-active');
    }
  }

  function closeDropdown() {
    if (DOM.moreDropdown) {
      DOM.moreDropdown.classList.remove('open');
      DOM.moreToggle.setAttribute('aria-expanded', 'false');
    }
  }
  // search query in side panel
  function bindSearch() {
    let timer = null;
    DOM.searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
        render();
      }, 120);
    });
  }

  function bindRefreshButton() {
    if (DOM.refreshBtn) {
      DOM.refreshBtn.addEventListener('click', () => {
        forceRefreshChat();
      });
    }
  }

  function updateRefreshBtn() {
    if (!DOM.refreshBtn) return;
    if (state.refreshing) {
      DOM.refreshBtn.classList.add('spinning');
      DOM.refreshBtn.disabled = true;
    } else {
      DOM.refreshBtn.classList.remove('spinning');
      DOM.refreshBtn.disabled = false;
    }
  }

  function render() {
    if (!state.connected) { showDisconnected(); return; }

    // tree map view xD
    if (state.activeFilter === 'map') {
      renderMap();
      return;
    }

    const nodes = getFilteredNodes();
    if (nodes.length === 0) { showEmpty(); return; }

    // groups the follow up below parent
    const ordered = groupFollowUps(nodes);

    const frag = document.createDocumentFragment();
    ordered.forEach(node => frag.appendChild(buildCard(node)));

    DOM.list.innerHTML = '';
    DOM.list.appendChild(frag);
  }

  function renderMap() {
    if (typeof DendriteMap === 'undefined') return;
    DendriteMap.render(state.questions, (node) => scrollTo(node));
  }

  function groupFollowUps(nodes) {
    // Only reorder questions
    if (nodes.length === 0 || nodes[0].type !== 'question') return nodes;

    const roots = [];
    const childMap = {};

    nodes.forEach(n => {
      if (n.parentId) {
        (childMap[n.parentId] = childMap[n.parentId] || []).push(n);
      } else {
        roots.push(n);
      }
    });

    // Flatten
    const result = [];
    function append(node) {
      result.push(node);
      const children = childMap[node.id];
      if (children) children.forEach(append);
    }
    roots.forEach(append);

    // orphaned follow up will be at last (will fix later.)
    const seen = new Set(result.map(n => n.id));
    nodes.forEach(n => { if (!seen.has(n.id)) result.push(n); });

    return result;
  }

  function getFilteredNodes() {
    const pools = {
      questions: state.questions,
      code: state.codeBlocks,
      links: state.links,
      artifacts: state.artifacts,
    };
    const pool = pools[state.activeFilter] || state.questions;

    if (!state.searchQuery) return pool;

    return pool.filter(n => {
      const hay = [n.preview, n.fullText, n.href, n.artifactType].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(state.searchQuery);
    });
  }

  // cards
  function buildCard(node) {
    const card = document.createElement('article');
    card.className = 'dn-card';
    card.dataset.type = node.type;
    card.dataset.id = node.id;

    if (node.type === 'question' && node.depth > 0) {
      card.dataset.depth = node.depth;
    }

    const badge = document.createElement('span');
    badge.className = 'dn-badge';
    badge.textContent = formatBadge(node);
    card.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'dn-card-body';

    const preview = document.createElement('p');
    preview.className = 'dn-card-preview';
    preview.textContent = node.preview;
    body.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'dn-card-meta';

    if (node.language) {
      const tag = document.createElement('span');
      tag.className = 'dn-language-tag';
      tag.textContent = node.language;
      meta.appendChild(tag);
    }

    if (node.type === 'question' && node.depth > 0) {
      const flow = document.createElement('span');
      flow.className = 'dn-flow-tag';
      flow.textContent = '↳ follow-up';
      meta.appendChild(flow);
    }

    if (node.href) {
      const domain = document.createElement('span');
      try { domain.textContent = new URL(node.href).hostname; }
      catch { domain.textContent = node.href.slice(0, 30); }
      meta.appendChild(domain);
    }

    body.appendChild(meta);
    card.appendChild(body);

    //copy code button
    if (node.type === 'code') {
      const btn = document.createElement('button');
      btn.className = 'dn-copy-btn';
      btn.title = 'Copy code';
      btn.textContent = '⎘';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyCode(node.fullText, btn);
      });
      card.appendChild(btn);
    }

    card.addEventListener('click', () => scrollTo(node));

    return card;
  }

  function formatBadge(node) {
    if (node.type === 'question' && node.depth > 0) {
      return `F${node.depth}`;
    }
    const prefix = { question: 'Q', code: 'C', link: 'L', artifact: 'A' };
    return `${prefix[node.type] || '#'}${node.index}`;
  }

  function scrollTo(node) {
    if (!state.activeTabId) return;
    chrome.tabs.sendMessage(state.activeTabId, {
      action: 'DENDRITE_SCROLL_TO',
      anchorId: node.id,
    });
  }

  async function copyCode(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '⎘';
    }, 1200);
  }

  function updateStats() {
    DOM.statQuestions.textContent = state.questions.length;
    DOM.statCode.textContent = state.codeBlocks.length;
    DOM.statLinks.textContent = state.links.length;
    if (DOM.statArtifacts) DOM.statArtifacts.textContent = state.artifacts.length;
  }

  function updateBadge() {
    DOM.platformBadge.textContent = state.platformName || '—';
  }

  function showEmpty() {
    const name = { questions: 'questions', code: 'code blocks', links: 'links', artifacts: 'artifacts' };

    //adds this tag set at every update
    DOM.list.innerHTML = `
      <div class="dn-empty">
        <div class="dn-empty-icon">
          <svg viewBox="0 0 24 24" stroke-linecap="square">
            <path d="M12 3v6M12 9L7 16M12 9l5 7M7 16L4 21M7 16l3 5M17 16l-3 5M17 16l3 5" />
          </svg>
        </div>
        <div class="dn-empty-title">No ${name[state.activeFilter] || 'items'}</div>
        <div class="dn-empty-desc">
          ${state.searchQuery
        ? 'No matches. Try different keywords.'
        : 'Begin a conversation — your index will appear here.'}
        </div>
      </div>
    `;
  }

  function showDisconnected() {
    state.connected = false;
    state.refreshing = false;
    updateRefreshBtn();

    DOM.list.innerHTML = `
      <div class="dn-disconnected">
        <div class="dn-disconnected-dot"></div>
        <div class="dn-disconnected-title">Not Connected</div>
        <div class="dn-disconnected-desc">
          Navigate to ChatGPT, Claude, or Gemini to activate.
        </div>
        <button class="dn-retry-btn" id="retry-btn">
          <span class="dn-retry-icon">↻</span>
          RETRY CONNECTION
        </button>
      </div>
    `;

    const btn = $('retry-btn');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<span class="dn-spinner"></span> CONNECTING…';
        await new Promise(r => setTimeout(r, 300));
        await refreshFromActiveTab();
        setTimeout(() => {
          const retryBtn = $('retry-btn');
          if (retryBtn) {
            retryBtn.disabled = false;
            retryBtn.innerHTML = '<span class="dn-retry-icon">↻</span> RETRY CONNECTION';
          }
        }, 3000);
      });
    }
  }

  //load when tab changed or switched.
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
