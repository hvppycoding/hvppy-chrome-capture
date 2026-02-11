// Content script: shows capture UI, handles click, orchestrates scrolling
// and stitching of viewport captures into a single screenshot.
// Supports both window-level scrolling and container-level scrolling

(() => {
  // Toggle: if already active, deactivate
  if (window.__hvppyCaptureActive) {
    if (typeof window.__hvppyCaptureDeactivate === 'function') {
      window.__hvppyCaptureDeactivate();
    }
    return;
  }

  window.__hvppyCaptureActive = true;

  let guideLineEl = null;
  let barEl = null;
  let progressEl = null;
  let isCapturing = false;

  // ── Scroll Container Detection ────────────────────────────────────
  // Some sites set overflow:hidden on html/body and
  // scroll inside a child container. We detect this so we can scroll
  // the right element during capture.

  function isDocumentScrollable() {
    const docEl = document.documentElement;
    const body = document.body;
    const docStyle = getComputedStyle(docEl);
    const bodyStyle = getComputedStyle(body);

    // If both html and body block overflow, document cannot scroll
    if (docStyle.overflowY === 'hidden' && bodyStyle.overflowY === 'hidden') {
      return false;
    }

    // Document is scrollable if its content exceeds the viewport
    return docEl.scrollHeight > window.innerHeight + 50;
  }

  function findScrollContainer() {
    // If the document itself scrolls, no need for a container
    if (isDocumentScrollable()) {
      return null;
    }

    // BFS through DOM to find the largest scrollable container
    const queue = Array.from(document.body.children);
    let best = null;
    let maxArea = 0;
    let count = 0;

    while (queue.length > 0 && count < 2000) {
      const el = queue.shift();
      count++;
      if (!el || el.nodeType !== 1) continue;

      // Skip our own overlay elements
      if (el.id && el.id.startsWith('hvppy-')) continue;

      const style = getComputedStyle(el);
      const oy = style.overflowY;

      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          el.scrollHeight > el.clientHeight + 10 &&
          el.clientHeight > 100) {
        const area = el.clientHeight * el.clientWidth;
        if (area > maxArea) {
          best = el;
          maxArea = area;
        }
      }

      // Enqueue children (depth-limited by total count)
      for (let i = 0; i < el.children.length && queue.length < 4000; i++) {
        queue.push(el.children[i]);
      }
    }

    return best;
  }

  // Build a scroll-context object that abstracts window vs container
  function createScrollContext() {
    const container = findScrollContainer();

    if (container) {
      const rect = container.getBoundingClientRect();
      return {
        type: 'container',
        element: container,
        containerTop: rect.top,                      // viewport offset to container top
        scrollStep: rect.height,                     // visible height of the container
        getScrollTop: () => container.scrollTop,
        setScroll: (y) => container.scrollTo({ top: y, left: 0, behavior: 'instant' }),
        // Click position within the container's full content
        getTargetY: (e) => container.scrollTop + (e.clientY - rect.top),
      };
    }

    return {
      type: 'window',
      element: null,
      containerTop: 0,
      scrollStep: window.innerHeight,
      getScrollTop: () => window.scrollY,
      setScroll: (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }),
      getTargetY: (e) => e.pageY,
    };
  }

  // ── UI Setup ──────────────────────────────────────────────────────

  function activate() {
    // Bottom instruction bar
    barEl = document.createElement('div');
    barEl.id = 'hvppy-capture-bar';
    barEl.innerHTML =
      '<div class="hvppy-bar-content">' +
        '<span class="hvppy-bar-icon">\u{1F4F8}</span>' +
        '<span class="hvppy-bar-text">Click anywhere to capture from top to that point</span>' +
        '<button id="hvppy-cancel-btn" class="hvppy-cancel-btn">\u2715 Cancel</button>' +
      '</div>';
    document.documentElement.appendChild(barEl);

    // Horizontal guide line following cursor
    guideLineEl = document.createElement('div');
    guideLineEl.id = 'hvppy-guide-line';
    document.documentElement.appendChild(guideLineEl);

    // Progress overlay (hidden until capture starts)
    progressEl = document.createElement('div');
    progressEl.id = 'hvppy-progress';
    progressEl.style.display = 'none';
    document.documentElement.appendChild(progressEl);

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);

    const cancelBtn = document.getElementById('hvppy-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deactivate();
      });
    }
  }

  // ── Event Handlers ────────────────────────────────────────────────

  function onMouseMove(e) {
    if (!guideLineEl || isCapturing) return;
    guideLineEl.style.top = e.pageY + 'px';
    guideLineEl.style.display = 'block';
  }

  async function onClick(e) {
    if (isCapturing) return;

    // Ignore clicks on our own UI
    if (e.target.closest('#hvppy-capture-bar') ||
        e.target.closest('#hvppy-progress')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    isCapturing = true;

    const scrollCtx = createScrollContext();
    const targetY = scrollCtx.getTargetY(e);
    const viewportWidth = window.innerWidth;
    const dpr = window.devicePixelRatio || 1;
    const pageTitle = document.title;
    const originalScroll = scrollCtx.getScrollTop();

    // Hide interactive UI, show progress
    hideInteractiveUI();
    showProgress('Preparing capture\u2026');

    try {
      await performCapture(scrollCtx, targetY, viewportWidth, dpr, pageTitle);
    } catch (err) {
      console.error('Capture failed:', err);
      showProgress('Capture failed: ' + err.message);
      await delay(2000);
    }

    // Restore original scroll position and clean up
    scrollCtx.setScroll(originalScroll);
    deactivate();
  }

  // ── Capture Logic ─────────────────────────────────────────────────

  async function performCapture(scrollCtx, targetY, viewportWidth, dpr, pageTitle) {
    if (targetY <= 0) {
      showProgress('Invalid click position');
      await delay(1000);
      return;
    }

    const scrollStep = scrollCtx.scrollStep;

    // Build list of scroll positions to cover [0, targetY)
    const scrollPositions = [];
    let y = 0;
    while (y < targetY) {
      scrollPositions.push(y);
      y += scrollStep;
    }
    if (scrollPositions.length === 0) {
      scrollPositions.push(0);
    }

    const captures = [];

    for (let i = 0; i < scrollPositions.length; i++) {
      const scrollTarget = scrollPositions[i];
      showProgress('Capturing section ' + (i + 1) + ' of ' + scrollPositions.length + '\u2026');

      // Scroll the correct element (window or container)
      scrollCtx.setScroll(scrollTarget);

      // Wait for rendering: two rAF frames + extra buffer
      await waitForPaint();
      await delay(300);

      const actualScrollY = scrollCtx.getScrollTop();

      // Hide progress overlay before capture so it doesn't appear in screenshot
      if (progressEl) progressEl.style.display = 'none';

      // Hide fixed/sticky elements and overlapping siblings so they don't cover content
      const hiddenEls = hideOverlayElements(scrollCtx);
      await waitForPaint();
      await delay(50);

      // Capture the visible viewport via background service worker
      const response = await sendMessage({ action: 'captureTab' });

      // Restore hidden elements and progress overlay
      restoreHiddenElements(hiddenEls);
      if (progressEl) progressEl.style.display = 'block';

      if (response && response.error) {
        throw new Error(response.error);
      }

      captures.push({
        dataUrl: response.dataUrl,
        scrollY: actualScrollY
      });
    }

    // Stitch all captured viewports into one image
    showProgress('Stitching screenshots\u2026');
    const finalDataUrl = await stitchCaptures(
      captures, targetY, viewportWidth, dpr, scrollCtx
    );

    // Request download via background script
    showProgress('Saving\u2026');
    await sendMessage({
      action: 'download',
      dataUrl: finalDataUrl,
      pageTitle: pageTitle
    });

    showProgress('Saved! \u2713');
    await delay(1000);
  }

  // ── Image Stitching ───────────────────────────────────────────────
  // Window-scroll mode: viewports tile at their scroll offset since
  //   the entire viewport content shifts when the window scrolls.
  // Container-scroll mode: simple vertical stacking. Each viewport
  //   capture is placed below the previous one. Fixed headers/footers
  //   will repeat in each section, but no content is ever hidden.
  //   The last capture is cropped at the click point.

  async function stitchCaptures(captures, targetY, viewportWidth, dpr, scrollCtx) {
    if (scrollCtx.type === 'container') {
      return stitchContainerScroll(captures, targetY, viewportWidth, dpr, scrollCtx);
    }
    return stitchWindowScroll(captures, targetY, viewportWidth, dpr);
  }

  // Window-scroll: place each capture at its scroll offset
  async function stitchWindowScroll(captures, targetY, viewportWidth, dpr) {
    const canvasHeight = Math.ceil(targetY * dpr);
    const canvasWidth = Math.ceil(viewportWidth * dpr);

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (const capture of captures) {
      const img = await loadImage(capture.dataUrl);
      const drawY = Math.round(capture.scrollY * dpr);
      const availableHeight = canvasHeight - drawY;
      const drawHeight = Math.min(img.height, availableHeight);

      if (drawHeight > 0) {
        ctx.drawImage(
          img,
          0, 0, img.width, drawHeight,
          0, drawY, img.width, drawHeight
        );
      }
    }

    return canvas.toDataURL('image/png');
  }

  // Container-scroll: stack full viewport captures vertically.
  // Repeated headers/footers are acceptable; content is never hidden.
  async function stitchContainerScroll(captures, targetY, viewportWidth, dpr, scrollCtx) {
    const images = [];
    for (const capture of captures) {
      images.push(await loadImage(capture.dataUrl));
    }
    if (images.length === 0) return '';

    const imgHeight = images[0].height;  // full viewport height in device px

    // For the last capture, find the row where the click point falls
    const lastCapture = captures[captures.length - 1];
    const clickInContainer = targetY - lastCapture.scrollY;
    const clickInViewport = scrollCtx.containerTop + clickInContainer;
    const lastCropHeight = Math.min(Math.ceil(clickInViewport * dpr), imgHeight);

    // Total height = full viewport for every capture except last + cropped last
    const canvasHeight = (images.length - 1) * imgHeight + lastCropHeight;
    const canvasWidth = images[0].width;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const destY = i * imgHeight;

      if (i < images.length - 1) {
        // Full viewport capture
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, destY, img.width, img.height);
      } else {
        // Last capture: crop at click point row
        ctx.drawImage(img, 0, 0, img.width, lastCropHeight, 0, destY, img.width, lastCropHeight);
      }
    }

    return canvas.toDataURL('image/png');
  }

  // ── Overlay Element Management ─────────────────────────────────────
  // Two categories of elements can obscure scrollable content:
  //   1. position:fixed / position:sticky — always visible on screen
  //   2. Non-descendant siblings of the scroll container that visually
  //      overlap it (e.g. a header <div> sitting above a scrollable
  //      <main> in a flex layout)
  // We hide both categories before each screenshot and restore after.

  function hideOverlayElements(scrollCtx) {
    const hidden = [];
    const containerEl = scrollCtx.element; // null for window-scroll

    // 1. Hide all fixed/sticky elements globally
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.id && el.id.startsWith('hvppy-')) continue;

      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        hidden.push({ el, prev: el.style.visibility });
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }

    // 2. For container-scroll sites: hide non-descendant elements that
    //    visually overlap the scroll container's bounding box.
    if (containerEl) {
      const containerRect = containerEl.getBoundingClientRect();

      // Walk up from the container to document.body, collecting each
      // ancestor's direct children (siblings at every level).
      let current = containerEl;
      while (current && current !== document.documentElement) {
        const parent = current.parentElement;
        if (!parent) break;

        for (const sibling of parent.children) {
          if (sibling === current) continue;
          if (sibling.id && sibling.id.startsWith('hvppy-')) continue;
          // Already hidden by fixed/sticky check
          if (hidden.some(h => h.el === sibling)) continue;

          const sibRect = sibling.getBoundingClientRect();
          // Check vertical overlap with the container
          if (sibRect.bottom > containerRect.top &&
              sibRect.top < containerRect.bottom &&
              sibRect.width > 0 && sibRect.height > 0) {
            hidden.push({ el: sibling, prev: sibling.style.visibility });
            sibling.style.setProperty('visibility', 'hidden', 'important');
          }
        }

        current = parent;
      }
    }

    return hidden;
  }

  function restoreHiddenElements(hidden) {
    for (const { el, prev } of hidden) {
      if (prev) {
        el.style.visibility = prev;
      } else {
        el.style.removeProperty('visibility');
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load captured image'));
      img.src = src;
    });
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, resolve);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  // ── UI Helpers ────────────────────────────────────────────────────

  function hideInteractiveUI() {
    if (barEl) barEl.style.display = 'none';
    if (guideLineEl) guideLineEl.style.display = 'none';
  }

  function showProgress(text) {
    if (progressEl) {
      progressEl.textContent = text;
      progressEl.style.display = 'block';
    }
  }

  function deactivate() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);

    if (barEl) barEl.remove();
    if (guideLineEl) guideLineEl.remove();
    if (progressEl) progressEl.remove();

    barEl = null;
    guideLineEl = null;
    progressEl = null;
    isCapturing = false;
    window.__hvppyCaptureActive = false;
  }

  // Expose deactivate so a re-injection can toggle off
  window.__hvppyCaptureDeactivate = deactivate;

  // Start
  activate();
})();
