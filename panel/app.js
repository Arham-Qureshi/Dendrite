'use strict';
(function () {
  const state = {
    questions: [],
    codeBlocks: [],
    links: [],
    activeFilter: 'questions',
    searchQuery: '',
    platform: null,
    platformName: '',
    connected: false,
    activeTabId: null,
  };
  //cahced DOM for later reference
  const $ = (id) => document.getElementById(id);

  const DOM = {
    list: $('node-list'),
    searchInput: $('search-input'),
    filterBar: $('filter-bar'),
    platformBadge: $('platform-badge'),
    statQuestions: $('stat-questions'),
    statCode: $('stat-code'),
    statLinks: $('stat-links'),
  };

  function init() {
    bindFilters();
    bindSearch();
    listenForMessages();
    refreshFromActiveTab();
  }

  function ingestPayload(payload) {
    state.questions = payload.questions || [];
    state.codeBlocks = payload.codeBlocks || [];
    state.links = payload.links || [];
    state.platform = payload.platform || null;
    state.platformName = payload.platformName || '';
    state.connected = true;

    updateStats();
    updateBadge();
    render();
  }

  async function refreshFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { showDisconnected(); return; }

      state.activeTabId = tab.id;

      chrome.tabs.sendMessage(tab.id, { action: 'DENDRITE_REFRESH' }, (res) => {
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
  // flash mssgs when triggers one of the following.
  function listenForMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'DENDRITE_UPDATE') ingestPayload(msg.payload);
      if (msg.action === 'DENDRITE_TAB_CHANGED') setTimeout(refreshFromActiveTab, 300);
    });
  }

  function bindFilters() {
    DOM.filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.dn-filter-btn');
      if (!btn || btn.dataset.filter === state.activeFilter) return;

      DOM.filterBar.querySelectorAll('.dn-filter-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      state.activeFilter = btn.dataset.filter;
      render();
    });
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

  function render() {
    if (!state.connected) { showDisconnected(); return; }

    const nodes = getFilteredNodes();
    if (nodes.length === 0) { showEmpty(); return; }

    const frag = document.createDocumentFragment();
    nodes.forEach(node => frag.appendChild(buildCard(node)));

    DOM.list.innerHTML = '';
    DOM.list.appendChild(frag);
  }

  function getFilteredNodes() {
    const pools = {
      questions: state.questions,
      code: state.codeBlocks,
      links: state.links,
    };
    const pool = pools[state.activeFilter] || state.questions;

    if (!state.searchQuery) return pool;

    return pool.filter(n => {
      const hay = [n.preview, n.fullText, n.href].filter(Boolean).join(' ').toLowerCase();
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
    const prefix = { question: 'Q', code: 'C', link: 'L' };
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
  }

  function updateBadge() {
    DOM.platformBadge.textContent = state.platformName || '—';
  }

  function showEmpty() {
    const name = { questions: 'questions', code: 'code blocks', links: 'links' };

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

    DOM.list.innerHTML = `
      <div class="dn-disconnected">
        <div class="dn-disconnected-dot"></div>
        <div class="dn-disconnected-title">Not Connected</div>
        <div class="dn-disconnected-desc">
          Navigate to ChatGPT, Claude, or Gemini to activate.
        </div>
        <button class="dn-refresh-btn" id="retry-btn">RETRY</button>
      </div>
    `;

    const btn = $('retry-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        btn.innerHTML = '<span class="dn-spinner"></span>';
        setTimeout(refreshFromActiveTab, 400);
      });
    }
  }

  //load when tab changed or switched.
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
