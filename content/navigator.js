'use strict';
window.Dendrite = window.Dendrite || {};

window.Dendrite.Navigator = (() => {
  function findAnchor(anchorId) {
    return document.querySelector(`[data-dendrite-id="${anchorId}"]`)
      || document.getElementById(anchorId);
  }

  function snapshotStyles(el) {
    el.dataset._dnOutline = el.style.outline || '';
    el.dataset._dnTransition = el.style.transition || '';
    el.dataset._dnRadius = el.style.borderRadius || '';
    el.dataset._dnShadow = el.style.boxShadow || '';
  }

  function applyGlow(el) {
    el.style.transition = 'outline 0.3s ease, box-shadow 0.3s ease';
    el.style.outline = `2px solid ${GLOW_COLOR}`;
    el.style.borderRadius = '8px';
    el.style.boxShadow = `0 0 24px ${GLOW_SHADOW}, inset 0 0 8px ${GLOW_SHADOW}`;
  }

  function removeGlow(el) {
    if (!el) return;

    el.style.outline = el.dataset._dnOutline || '';
    el.style.transition = el.dataset._dnTransition || '';
    el.style.borderRadius = el.dataset._dnRadius || '';
    el.style.boxShadow = el.dataset._dnShadow || '';

    delete el.dataset._dnOutline;
    delete el.dataset._dnTransition;
    delete el.dataset._dnRadius;
    delete el.dataset._dnShadow;
  }

  function clearHighlight() {
    clearTimeout(clearTimer);
    removeGlow(activeEl);
    activeEl = null;
  }

  return {

    scrollTo(anchorId) {
      const el = findAnchor(anchorId);
      if (!el) {
        console.warn(`[Dendrite] Anchor not found: ${anchorId}`);
        return false;
      }

      clearHighlight();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      requestAnimationFrame(() => {
        snapshotStyles(el);
        applyGlow(el);
        activeEl = el;

        clearTimer = setTimeout(clearHighlight, GLOW_DURATION_MS);
      });

      return true;
    },
  };

})();