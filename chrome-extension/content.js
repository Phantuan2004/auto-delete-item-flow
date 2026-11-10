/**
 * Google Flow (Veo 3) - Bulk Item Cleaner (Hybrid Turbo)
 * Engine v2.1.0 - Chrome Extension Content Script
 */

(function () {
  'use strict';

  // 1. INJECT NETWORK SNIFFER
  let capturedApiData = null;
  let isListeningForDelete = false;

  function initSniffer() {
    if (window.__VEO3_SNIFFER_INITIALIZED__) return;
    window.__VEO3_SNIFFER_INITIALIZED__ = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const [resource, config] = args;
      const url = typeof resource === 'string' ? resource : resource?.url || '';
      const method = (config?.method || 'GET').toUpperCase();

      if (method !== 'GET') {
        if (isListeningForDelete || /delete|remove|asset|generation|media|project|item|batchexecute/i.test(url)) {
          capturedApiData = {
            url: url,
            method: method,
            headers: config?.headers || {}
          };
          window.postMessage({ type: 'VEO3_API_FOUND', url: url }, '*');
        }
      }
      return originalFetch.apply(this, args);
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._vMethod = method;
      this._vUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this._vMethod && this._vMethod !== 'GET') {
        if (isListeningForDelete || /delete|remove|asset|generation/i.test(this._vUrl)) {
          capturedApiData = { url: this._vUrl, method: this._vMethod };
          window.postMessage({ type: 'VEO3_API_FOUND', url: this._vUrl }, '*');
        }
      }
      return origSend.apply(this, arguments);
    };
  }
  initSniffer();

  // 2. CONFIGURATION & STATE
  const CONFIG = {
    skipCollections: true,
    scanDelay: 350,
    deleteTimeout: 5000,

    trashSelectors: [
      'button[aria-label*="Xóa" i]',
      'button[aria-label*="Delete" i]',
      'button[aria-label*="Remove" i]',
      'button[aria-label*="Thùng rác" i]',
      'button[title*="Xóa" i]',
      'button[title*="Delete" i]',
      'button[data-testid*="delete" i]',
      'button:has(svg path[d*="M6 19"])',
      'button:has(svg path[d*="M16 9"])',
      'button:has(svg path[d*="M15 4"])',
      'button:has(svg path[d*="19c0 1.1"])',
      'button:has(svg path[d*="M3 6h18"])'
    ],
    collectionKeywords: /(bộ sưu tập|collection|album|tập hợp|danh sách kết hợp|series)/i
  };

  const State = {
    isRunning: false,
    shouldStop: false,
    totalFound: 0,
    deletedCount: 0,
    skippedCollections: 0
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 3. BỘ LỌC BẢO VỆ BỘ SƯU TẬP
  function isBelongToCollection(element) {
    if (!CONFIG.skipCollections) return false;
    const card = element.closest('[role="listitem"], [role="gridcell"], article') || element.parentElement?.parentElement;
    if (!card) return false;

    const cardText = (card.innerText || '').slice(0, 300);
    if (CONFIG.collectionKeywords.test(cardText)) return true;

    const attrString = (card.className + ' ' + (card.getAttribute('data-type') || '') + ' ' + (card.getAttribute('aria-label') || '')).toLowerCase();
    if (CONFIG.collectionKeywords.test(attrString)) return true;

    const mediaCount = card.querySelectorAll('video, img[src*="googleusercontent"]').length;
    if (mediaCount > 2 && element.parentElement?.tagName !== 'DIV') return true;

    return false;
  }

  function isVisible(element) {
    if (!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function getActionLabel(element) {
    return [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.getAttribute('data-tooltip'),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function findValidTrashButtons() {
    const candidateButtons = new Set();

    for (const sel of CONFIG.trashSelectors) {
      document.querySelectorAll(sel).forEach(b => candidateButtons.add(b));
    }

    document.querySelectorAll('button, [role="button"]').forEach(button => {
      const label = getActionLabel(button);
      if (/(delete|remove|trash|xóa|xoá|thùng rác)/i.test(label)) {
        candidateButtons.add(button);
      }
    });

    const validButtons = [];
    let skippedCount = 0;

    candidateButtons.forEach(btn => {
      if (btn.closest('#veo3-cleaner-widget') || !isVisible(btn) || btn.disabled) return;
      if (isBelongToCollection(btn)) {
        skippedCount++;
        return;
      }
      validButtons.push(btn);
    });

    State.skippedCollections = skippedCount;
    return validButtons;
  }

  function getScrollableElements() {
    return Array.from(document.querySelectorAll('body *')).filter(element => {
      if (element.closest('#veo3-cleaner-widget')) return false;
      const style = window.getComputedStyle(element);
      return /(auto|scroll|overlay)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 20 &&
        element.clientHeight > 0;
    });
  }

  function getItemKey(button) {
    const card = button.closest('[role="listitem"], [role="gridcell"], article') || button.parentElement?.parentElement;
    if (!card) return getActionLabel(button);

    const id = [
      card.getAttribute('data-id'),
      card.getAttribute('data-asset-id'),
      card.getAttribute('data-testid'),
      card.id
    ].filter(Boolean).join('|');
    const href = card.querySelector('a[href]')?.getAttribute('href') || '';
    const mediaElement = card.querySelector('img, video');
    const media = mediaElement?.currentSrc || mediaElement?.getAttribute('src') ||
      card.querySelector('video')?.getAttribute('poster') || '';
    const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    return [id, href, media, text, getActionLabel(button)].filter(Boolean).join('|') ||
      card.outerHTML.slice(0, 1000);
  }

  async function scanAllItems(onProgress, onItem) {
    const foundButtons = new Map();
    const scrollables = getScrollableElements();
    const positions = new Map(scrollables.map(element => [element, element.scrollTop]));
    const root = document.scrollingElement || document.documentElement;
    const useWindow = root.scrollHeight > window.innerHeight + 20;
    const windowPosition = window.scrollY;

    const collect = async () => {
      let processedCount = 0;
      for (const button of findValidTrashButtons()) {
        const key = getItemKey(button);
        foundButtons.set(key, button);
        if (onItem && await onItem(button, key)) processedCount++;
      }
      if (onProgress) onProgress(foundButtons.size);
      return processedCount;
    };

    await collect();

    if (useWindow) {
      window.scrollTo(0, 0);
      await sleep(CONFIG.scanDelay);
      let previousHeight = -1;
      let stableBottomPasses = 0;
      for (let step = 0; step < 300 && stableBottomPasses < 3 && !State.shouldStop; step++) {
        let processedCount = await collect();
        while (processedCount > 0 && !State.shouldStop) processedCount = await collect();
        const height = root.scrollHeight;
        const atBottom = window.scrollY + window.innerHeight >= height - 4;
        if (atBottom && height === previousHeight) stableBottomPasses++;
        else stableBottomPasses = 0;
        previousHeight = height;
        if (!atBottom) window.scrollBy(0, Math.max(300, Math.floor(window.innerHeight * 0.8)));
        await sleep(CONFIG.scanDelay);
      }
      await collect();
    }

    for (const element of scrollables) {
      if (!element.isConnected) continue;
      element.scrollTop = 0;
      await sleep(CONFIG.scanDelay);
      let previousHeight = -1;
      let stableBottomPasses = 0;
      for (let step = 0; step < 300 && stableBottomPasses < 3 && !State.shouldStop; step++) {
        let processedCount = await collect();
        while (processedCount > 0 && !State.shouldStop) processedCount = await collect();
        const height = element.scrollHeight;
        const atBottom = element.scrollTop + element.clientHeight >= height - 4;
        if (atBottom && height === previousHeight) stableBottomPasses++;
        else stableBottomPasses = 0;
        previousHeight = height;
        if (!atBottom) element.scrollTop += Math.max(250, Math.floor(element.clientHeight * 0.8));
        await sleep(CONFIG.scanDelay);
      }
      await collect();
    }

    positions.forEach((top, element) => {
      if (element.isConnected) element.scrollTop = top;
    });
    if (useWindow) window.scrollTo(0, windowPosition);
    updateStatus(`Quét xong: tìm thấy ${foundButtons.size} nút xóa.`);
    return Array.from(foundButtons.keys());
  }

  function findDeleteConfirmation() {
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const dialog of dialogs) {
      const buttons = dialog.querySelectorAll('button, [role="button"]');
      for (const button of buttons) {
        const label = getActionLabel(button);
        if (/(delete|remove|xóa|xoá|thùng rác)/i.test(label) && isVisible(button) && !button.disabled) {
          return button;
        }
      }
    }
    return null;
  }

  async function waitForRemoval(button, card) {
    const deadline = Date.now() + CONFIG.deleteTimeout;
    while (Date.now() < deadline) {
      if (!button.isConnected || (card && !card.isConnected)) return true;
      await sleep(100);
    }
    return !button.isConnected || (card && !card.isConnected);
  }

  async function deleteOne(button) {
    if (!button.isConnected || !isVisible(button)) return false;
    const card = button.closest('[role="listitem"], [role="gridcell"], article') || button.parentElement?.parentElement;
    button.click();

    let confirmation = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      confirmation = findDeleteConfirmation();
      if (confirmation) break;
      if (!button.isConnected || (card && !card.isConnected)) return true;
      await sleep(100);
    }

    if (confirmation) {
      confirmation.click();
      for (let attempt = 0; attempt < 50; attempt++) {
        if (!button.isConnected || (card && !card.isConnected)) return true;
        if (!findDeleteConfirmation()) {
          await sleep(300);
          return !button.isConnected || (card && !card.isConnected);
        }
        await sleep(100);
      }
      return false;
    }

    return waitForRemoval(button, card);
  }

  // 4. XÓA TUẦN TỰ ĐỂ TRÁNH XUNG ĐỘT HỘP THOẠI
  async function runTurboFastBatch() {
    if (State.isRunning) return;
    State.isRunning = true;
    State.shouldStop = false;
    toggleRunningUI(true);
    try {
      const buttons = await scanAllItems();
      if (State.shouldStop) {
        updateStatus('Đã dừng trước khi xóa.');
        return;
      }
      State.totalFound = buttons.length;
      updateProgress();
      if (buttons.length === 0) {
        updateStatus('Không tìm thấy nút xóa nào trên trang.');
        alert('Không tìm thấy item nào. Hãy mở dự án và thử quét lại.');
        return;
      }

      const confirmed = confirm(
        `⚠️ XÁC NHẬN XÓA:\n\n` +
        `Tìm thấy ${buttons.length} nút xóa.\n` +
        `Các item sẽ được xóa lần lượt để xử lý đúng hộp thoại xác nhận.\n` +
        `(Bộ sưu tập lớn sẽ được GIỮ NGUYÊN AN TOÀN).\n\n` +
        `Bấm OK để thực hiện!`
      );
      if (!confirmed) return;

      State.shouldStop = false;
      State.deletedCount = 0;
      updateProgress();
      log(`Bắt đầu xóa tuần tự ${buttons.length} items...`, 'warning');

      const processedItems = new Set();
      await scanAllItems(count => {
        if (count > State.totalFound) {
          State.totalFound = count;
          updateProgress();
        }
      }, async (button, key) => {
        if (State.shouldStop || !button.isConnected || !isVisible(button) || processedItems.has(key)) return false;
        processedItems.add(key);
        updateStatus(`Đang xử lý ${processedItems.size}/${State.totalFound}...`);
        if (await deleteOne(button)) {
          State.deletedCount++;
          log(`Đã xác nhận xóa ${State.deletedCount}/${State.totalFound}.`, 'success');
        } else {
          log(`Không xác nhận được item ${processedItems.size}; bỏ qua để tránh báo sai.`, 'warning');
        }
        updateProgress();
        return true;
      });

      const remaining = Math.max(0, State.totalFound - State.deletedCount);
      log(`Kết thúc: xác nhận xóa ${State.deletedCount}/${State.totalFound}; còn ${remaining} item chưa xác nhận.`, remaining === 0 ? 'success' : 'warning');
      updateStatus(State.shouldStop ? 'Đã dừng theo yêu cầu.' : `Đã xác nhận xóa ${State.deletedCount}/${State.totalFound}. Còn ${remaining} item chưa xác nhận.`);
    } catch (error) {
      log(`Lỗi khi quét hoặc xóa: ${error.message}`, 'error');
      updateStatus('Đã xảy ra lỗi. Xem nhật ký để biết chi tiết.');
    } finally {
      State.isRunning = false;
      toggleRunningUI(false);
    }
  }

  // 5. GIAO DIỆN & TIỆN ÍCH
  function injectUI() {
    if (document.getElementById('veo3-cleaner-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'veo3-cleaner-widget';
    widget.innerHTML = `
      <div class="veo3-header" id="veo3-drag-header">
        <div class="veo3-title">
          <span class="veo3-dot"></span>
          <span>Flow Veo 3 Cleaner</span>
        </div>
        <div class="veo3-header-btns">
          <button class="veo3-btn-icon" id="veo3-btn-minimize" title="Thu nhỏ/Mở rộng">_</button>
          <button class="veo3-btn-icon" id="veo3-btn-close" title="Tắt hẳn tiện ích">✕</button>
        </div>
      </div>

      <div class="veo3-body" id="veo3-body-content">
        <div class="veo3-stats">
          <div class="veo3-stat-item">
            <span class="veo3-label">Item con (Xóa)</span>
            <span class="veo3-value" id="veo3-stat-found">0</span>
          </div>
          <div class="veo3-stat-item">
            <span class="veo3-label">Đã xóa</span>
            <span class="veo3-value success" id="veo3-stat-deleted">0</span>
          </div>
        </div>

        <div class="veo3-api-status-box">
          <span class="veo3-api-badge active" id="veo3-api-badge">Quét toàn bộ dự án</span>
        </div>

        <div class="veo3-toggle-row">
          <label class="veo3-checkbox-label">
            <input type="checkbox" id="veo3-chk-skip-collections" checked>
            <span>🛡️ Bỏ qua & Giữ lại Bộ sưu tập</span>
          </label>
        </div>

        <div class="veo3-progress-container">
          <div class="veo3-progress-bar" id="veo3-progress"></div>
        </div>

        <div class="veo3-status" id="veo3-status-text">Sẵn sàng dọn dẹp</div>

        <div class="veo3-actions">
          <button id="veo3-btn-scan" class="veo3-btn secondary">🔍 Quét & Cuộn toàn bộ trang</button>
          
          <button id="veo3-btn-turbo" class="veo3-btn turbo">🗑️ XÓA TẤT CẢ (TUẦN TỰ AN TOÀN)</button>
          
          <button id="veo3-btn-backup" class="veo3-btn secondary">📥 Sao lưu Prompts ra JSON</button>
          <button id="veo3-btn-stop" class="veo3-btn secondary" style="display:none;">⏹️ Dừng khẩn cấp</button>
        </div>

        <div class="veo3-console" id="veo3-console-log">
          <div class="veo3-log-info">[System] Trình quét dự án đã sẵn sàng.</div>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    const reopenPill = document.createElement('div');
    reopenPill.id = 'veo3-reopen-pill';
    reopenPill.title = 'Nhấp để mở lại Flow Veo 3 Cleaner';
    reopenPill.style.display = 'none';
    reopenPill.innerHTML = `<span>⚡ Flow Cleaner Turbo</span>`;
    document.body.appendChild(reopenPill);

    setupDraggable(widget, document.getElementById('veo3-drag-header'));
    bindUIEvents();
  }

  function log(msg, type = 'info') {
    const consoleBox = document.getElementById('veo3-console-log');
    if (!consoleBox) return;
    const time = new Date().toLocaleTimeString('vi-VN');
    const line = document.createElement('div');
    line.className = `veo3-log-${type}`;
    line.textContent = `[${time}] ${msg}`;
    consoleBox.appendChild(line);
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  function updateStatus(text) {
    const el = document.getElementById('veo3-status-text');
    if (el) el.textContent = text;
  }

  function updateProgress() {
    const foundEl = document.getElementById('veo3-stat-found');
    const deletedEl = document.getElementById('veo3-stat-deleted');
    const barEl = document.getElementById('veo3-progress');
    if (foundEl) foundEl.textContent = State.totalFound;
    if (deletedEl) deletedEl.textContent = State.deletedCount;
    if (barEl) {
      const pct = State.totalFound > 0 ? Math.min(100, Math.round((State.deletedCount / State.totalFound) * 100)) : 0;
      barEl.style.width = `${pct}%`;
    }
  }

  function toggleRunningUI(running) {
    const btnTurbo = document.getElementById('veo3-btn-turbo');
    const btnScan = document.getElementById('veo3-btn-scan');
    const btnStop = document.getElementById('veo3-btn-stop');
    if (running) {
      btnTurbo.style.display = 'none';
      btnScan.style.display = 'none';
      btnStop.style.display = 'block';
    } else {
      btnTurbo.style.display = 'block';
      btnScan.style.display = 'block';
      btnStop.style.display = 'none';
    }
  }

  function bindUIEvents() {
    const widget = document.getElementById('veo3-cleaner-widget');
    const reopenPill = document.getElementById('veo3-reopen-pill');

    document.getElementById('veo3-btn-minimize').addEventListener('click', () => {
      const body = document.getElementById('veo3-body-content');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('veo3-btn-close').addEventListener('click', () => {
      widget.style.display = 'none';
      if (reopenPill) reopenPill.style.display = 'flex';
    });

    if (reopenPill) {
      reopenPill.addEventListener('click', () => {
        widget.style.display = 'block';
        reopenPill.style.display = 'none';
      });
    }

    document.getElementById('veo3-chk-skip-collections').addEventListener('change', (event) => {
      CONFIG.skipCollections = event.target.checked;
    });

    document.getElementById('veo3-btn-scan').addEventListener('click', async () => {
      if (State.isRunning) return;
      State.isRunning = true;
      State.shouldStop = false;
      toggleRunningUI(true);
      log('Đang quét các vùng cuộn để tải item...');
      try {
        const buttons = await scanAllItems(count => updateStatus(`Đã phát hiện ${count} nút xóa...`));
        State.totalFound = buttons.length;
        updateProgress();
        log(State.shouldStop ? `Đã dừng quét tại ${buttons.length} nút.` : `Quét xong! Tìm thấy ${buttons.length} nút xóa.`, State.shouldStop ? 'warning' : 'success');
      } catch (error) {
        log(`Lỗi khi quét: ${error.message}`, 'error');
        updateStatus('Quét thất bại. Xem nhật ký để biết chi tiết.');
      } finally {
        State.isRunning = false;
        toggleRunningUI(false);
      }
    });

    document.getElementById('veo3-btn-turbo').addEventListener('click', () => {
      runTurboFastBatch();
    });

    document.getElementById('veo3-btn-stop').addEventListener('click', () => {
      State.shouldStop = true;
      log('Đã gửi lệnh DỪNG KHẨN CẤP!', 'warning');
    });

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'VEO3_API_FOUND') {
        log(`📡 Bắt được gói tin API: ${e.data.url.slice(-30)}`, 'success');
      }
    });
  }

  function setupDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = (e) => {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = `${element.offsetTop - pos2}px`;
        element.style.left = `${element.offsetLeft - pos1}px`;
        element.style.bottom = 'auto';
        element.style.right = 'auto';
      };
    };
  }

  // Khởi động UI
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(injectUI, 1200);
  } else {
    window.addEventListener('load', () => setTimeout(injectUI, 1200));
  }
})();
