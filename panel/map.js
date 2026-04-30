'use strict';
//for better computation we use cpp algo.
const DendriteMap = (() => {

  const CFG = {
    padX: 80,
    padY: 90,
    baseX: 50,
    baseY: 50,
    nodeR: 14,
    rootR: 16,
    virtualR: 11,
    ringPad: 6,
    labelY: 28,
    cornerR: 8,
  };

  const VROOT = '__dn_chat__';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // state (parent)
  let wasm = null, wasmReady = false;
  let viewportEl = null, tooltipEl = null, svgRoot = null;
  let scrollCb = null, activeId = null;
  let treeMap = {};
  let idToInt = {}, intToId = {}, nextInt = 0;

  // wasm to compile cpp to run on browser.
  async function loadWasm() {
    if (wasmReady) return;
    try {
      const mod = await TreeEngineModule();
      wasm = {
        reset: mod.cwrap('reset', null, []),
        addNode: mod.cwrap('addNode', null, ['number']),
        addEdge: mod.cwrap('addEdge', null, ['number', 'number']),
        computeLayout: mod.cwrap('computeLayout', null, ['number', 'number', 'number', 'number']),
        getNodeX: mod.cwrap('getNodeX', 'number', ['number']),
        getNodeY: mod.cwrap('getNodeY', 'number', ['number']),
      };
      wasmReady = true;
    } catch (e) {
      console.warn('[Dendrite Map] WASM unavailable, using JS layout', e);
    }
  }

  function mid(strId) {
    if (idToInt[strId] !== undefined) return idToInt[strId];
    const n = nextInt++;
    idToInt[strId] = n;
    intToId[n] = strId;
    return n;
  }

  function buildTree(questions) {
    const vRoot = {
      id: VROOT, type: 'virtual', index: 0,
      preview: 'Chat', fullText: '', parentId: null,
      depth: 0, isVirtual: true, treeParent: null,
    };

    const qMap = {};
    for (const q of questions) qMap[q.id] = q;

    const nodes = [vRoot];
    for (const q of questions) {
      const n = Object.assign({}, q);
      if (!n.parentId || !qMap[n.parentId]) {
        n.treeParent = VROOT;
      } else {
        n.treeParent = n.parentId;
      }
      nodes.push(n);
    }
    return nodes;
  }


  function layout(treeNodes) {
    return wasmReady ? layoutWasm(treeNodes) : layoutJS(treeNodes);
  }

  function layoutWasm(nodes) {
    wasm.reset();
    idToInt = {}; intToId = {}; nextInt = 0;

    for (const n of nodes) wasm.addNode(mid(n.id));
    for (const n of nodes) {
      if (n.treeParent && idToInt[n.treeParent] !== undefined)
        wasm.addEdge(idToInt[n.treeParent], idToInt[n.id]);
    }

    wasm.computeLayout(CFG.padX, CFG.padY, CFG.baseX, CFG.baseY);

    const pos = {};
    for (const n of nodes) {
      pos[n.id] = { x: wasm.getNodeX(idToInt[n.id]), y: wasm.getNodeY(idToInt[n.id]) };
    }
    return pos;
  }

  function layoutJS(nodes) {
    const kids = {};
    const roots = [];
    for (const n of nodes) kids[n.id] = [];
    for (const n of nodes) {
      if (n.treeParent && kids[n.treeParent]) kids[n.treeParent].push(n.id);
      else roots.push(n.id);
    }

    const pos = {};
    let leafX = CFG.baseX;

    function place(id, depth) {
      const ch = kids[id] || [];
      if (!ch.length) {
        pos[id] = { x: leafX, y: CFG.baseY + depth * CFG.padY };
        leafX += CFG.padX;
        return;
      }
      for (const c of ch) place(c, depth + 1);
      pos[id] = {
        x: (pos[ch[0]].x + pos[ch[ch.length - 1]].x) / 2,
        y: CFG.baseY + depth * CFG.padY,
      };
    }

    for (const r of roots) place(r, 0);
    for (const n of nodes) {
      if (!pos[n.id]) { pos[n.id] = { x: leafX, y: CFG.baseY }; leafX += CFG.padX; }
    }
    return pos;
  }

  //svg is used for drawing nodes and edges.
  function cel(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function elbowPath(x1, y1, x2, y2) {
    if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
    const my = (y1 + y2) / 2;
    const r = Math.min(CFG.cornerR, Math.abs(my - y1), Math.abs(x2 - x1) / 2);
    const dx = x2 > x1 ? 1 : -1;
    return `M${x1},${y1} V${my - r} Q${x1},${my},${x1 + r * dx},${my} H${x2 - r * dx} Q${x2},${my},${x2},${my + r} V${y2}`;
  }

  function drawTree(treeNodes, pos) {
    viewportEl.innerHTML = '';

    let maxX = 0, maxY = 0;
    for (const p of Object.values(pos)) {
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX + CFG.padX + CFG.baseX;
    const h = maxY + CFG.padY + CFG.baseY;

    svgRoot = cel('svg', {
      class: 'dn-map-svg', width: w, height: h,
      viewBox: `0 0 ${w} ${h}`,
    });

    const edgesG = cel('g', { class: 'dn-edges-group' });
    const nodesG = cel('g', { class: 'dn-nodes-group' });
    svgRoot.appendChild(edgesG);
    svgRoot.appendChild(nodesG);

    for (const n of treeNodes) {
      if (!n.treeParent || !pos[n.treeParent]) continue;
      const p = pos[n.treeParent], c = pos[n.id];
      edgesG.appendChild(cel('path', {
        class: `dn-edge${n.treeParent === VROOT ? ' trunk' : ''}`,
        d: elbowPath(p.x, p.y, c.x, c.y),
        'data-parent': n.treeParent,
        'data-child': n.id,
      }));
    }

    for (const n of treeNodes) {
      const p = pos[n.id];
      if (!p) continue;

      const isV = n.isVirtual;
      const isRoot = !isV && (!n.parentId || !treeMap[n.parentId]);
      const r = isV ? CFG.virtualR : (isRoot ? CFG.rootR : CFG.nodeR);

      const g = cel('g', {
        class: 'dn-map-node' + (isV ? ' virtual' : '') + (isRoot ? ' root' : ''),
        'data-id': n.id,
        transform: `translate(${p.x},${p.y})`,
      });

      if (isRoot) {
        g.appendChild(cel('circle', {
          class: 'dn-node-ring', cx: 0, cy: 0, r: r + CFG.ringPad,
        }));
      }

      //when hovering dim the rest for focus.
      g.appendChild(cel('circle', {
        class: 'dn-node-hit', cx: 0, cy: 0, r: r + 8,
      }));

      g.appendChild(cel('circle', {
        class: 'dn-node-dot', cx: 0, cy: 0, r: r,
      }));

      const idx = cel('text', { class: 'dn-node-index', x: 0, y: 1 });
      if (isV) {
        idx.textContent = '◈';
      } else {
        idx.textContent = n.depth > 0 ? `F${n.depth}` : `${n.index}`;
      }
      g.appendChild(idx);

      if (!isV) {
        const lbl = cel('text', { class: 'dn-node-label', x: 0, y: CFG.labelY });
        lbl.textContent = trunc(n.preview, 14);
        g.appendChild(lbl);
      }

      if (!isV) {
        g.addEventListener('click', () => onNodeClick(n));
        g.addEventListener('mouseenter', (e) => tipShow(e, n));
        g.addEventListener('mouseleave', tipHide);
      }

      nodesG.appendChild(g);
    }

    viewportEl.appendChild(svgRoot);
  }

  function onNodeClick(node) {
    if (activeId === node.id) { clearHL(); activeId = null; return; }
    activeId = node.id;
    highlightAncestors(node.id);
    if (scrollCb) scrollCb(node);
  }

  function highlightAncestors(nid) {
    const chain = new Set();
    let cur = nid;
    while (cur) {
      chain.add(cur);
      const n = treeMap[cur];
      cur = n ? (n.treeParent || n.parentId) : null;
    }
    for (const n of Object.values(treeMap)) {
      if (n.treeParent === nid || n.parentId === nid) chain.add(n.id);
    }

    svgRoot.querySelectorAll('.dn-map-node').forEach(g => {
      const id = g.dataset.id;
      g.classList.toggle('active', id === nid);
      g.classList.toggle('dimmed', !chain.has(id) && id !== VROOT);
    });
    svgRoot.querySelectorAll('.dn-edge').forEach(p => {
      const inPath = chain.has(p.dataset.parent) && chain.has(p.dataset.child);
      p.classList.toggle('highlighted', inPath);
      p.classList.toggle('dimmed', !inPath);
    });
  }

  function clearHL() {
    if (!svgRoot) return;
    svgRoot.querySelectorAll('.active,.dimmed,.highlighted').forEach(el => {
      el.classList.remove('active', 'dimmed', 'highlighted');
    });
  }

  function tipShow(evt, node) {
    if (!tooltipEl) return;
    const badge = node.depth > 0 ? `FOLLOW-UP ${node.depth}` : `QUESTION ${node.index}`;
    tooltipEl.innerHTML =
      `<span class="dn-map-tooltip-badge">${badge}</span>` + esc(node.preview);
    tooltipEl.classList.add('visible');

    const rect = evt.currentTarget.getBoundingClientRect();
    const tw = 220;
    let x = rect.right + 10;
    if (x + tw > window.innerWidth) x = rect.left - tw - 10;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = (rect.top - 4) + 'px';
  }

  function tipHide() {
    if (tooltipEl) tooltipEl.classList.remove('visible');
  }

  function trunc(t, max) {
    if (!t) return '';
    const c = t.replace(/\s+/g, ' ').trim();
    return c.length <= max ? c : c.slice(0, max) + '…';
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function showEmpty() {
    viewportEl.innerHTML = `
      <div class="dn-map-empty">
        <div class="dn-map-empty-icon">
          <svg viewBox="0 0 24 24" stroke-linecap="square">
            <path d="M12 3v6M12 9L7 16M12 9l5 7M7 16L4 21M7 16l3 5M17 16l-3 5M17 16l3 5" />
          </svg>
        </div>
        <div class="dn-map-empty-title">No map data</div>
        <div class="dn-map-empty-desc">
          Begin a conversation — your logic tree will grow here.
        </div>
      </div>`;
  }

  return {
    async init(vp, tip) {
      viewportEl = vp;
      tooltipEl = tip;
      await loadWasm();
    },

    render(questions, onScroll) {
      if (!viewportEl) return;
      scrollCb = onScroll;

      if (!questions || !questions.length) { showEmpty(); return; }

      const tree = buildTree(questions);
      treeMap = {};
      for (const n of tree) treeMap[n.id] = n;

      const pos = layout(tree);

      drawTree(tree, pos);
      activeId = null;
    },

    destroy() {
      if (svgRoot) svgRoot.remove();
      svgRoot = null; viewportEl = null; tooltipEl = null;
      activeId = null; treeMap = {};
    },
  };

})();