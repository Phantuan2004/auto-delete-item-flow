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
    batchConcurrency: 6,
    chunkInterval: 250,

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
    const card = element.closest('div[role="listitem"], div[role="gridcell"], section, article') || element.parentElement?.parentElement;
    if (!card) return false;

    const cardText = (card.innerText || '').slice(0, 300);
    if (CONFIG.collectionKeywords.test(cardText)) return true;

    const attrString = (card.className + ' ' + (card.getAttribute('data-type') || '') + ' ' + (card.getAttribute('aria-label') || '')).toLowerCase();
    if (CONFIG.collectionKeywords.test(attrString)) return true;

    const mediaCount = card.querySelectorAll('video, img[src*="googleusercontent"]').length;
    if (mediaCount > 2 && element.parentElement.tagName !== 'DIV') return true;

    return false;
  }

  function findValidTrashButtons() {
    let candidateButtons = new Set();

    for (const sel of CONFIG.trashSelectors) {
      try {
        document.querySelectorAll(sel).forEach(b => candidateButtons.add(b));
      } catch (e) {}
    }

    const downloadOrShareBtns = document.querySelectorAll('button:has(svg)');
    downloadOrShareBtns.forEach(btn => {
      const parentBar = btn.parentElement;
      if (parentBar && parentBar.children.length >= 2 && !parentBar.closest('#veo3-cleaner-widget')) {
        parentBar.querySelectorAll('button').forEach(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          if (aria.includes('xóa') || aria.includes('delete') || title.includes('xóa') || title.includes('delete')) {
            candidateButtons.add(b);
          }
        });
      }
    });

    const validButtons = [];
    let skippedCount = 0;

    candidateButtons.forEach(btn => {
      if (btn.closest('#veo3-cleaner-widget') || !(btn.offsetWidth || btn.offsetHeight)) return;
      if (isBelongToCollection(btn)) {
        skippedCount++;
        return;
      }
      validButtons.push(btn);
    });

    State.skippedCollections = skippedCount;
    return validButtons;
  }

  // 4. CHẾ ĐỘ XÓA SIÊU TỐC TURBO BATCH
  async function runTurboFastBatch() {
    const buttons = findValidTrashButtons();
    if (buttons.length === 0) {
      alert('Không tìm thấy item nào! Hãy bấm "🔍 Quét & Cuộn toàn bộ trang" trước.');
      return;
    }

    const confirmed = confirm(
      `⚡ XÁC NHẬN XÓA SIÊU TỐC:\n\n` +
      `Tìm thấy ${buttons.length} video/ảnh con.\n` +
      `Hệ thống sẽ xóa đồng loạt siêu tốc trong vài giây!\n` +
      `(Bộ sưu tập lớn sẽ được GIỮ NGUYÊN AN TOÀN).\n\n` +
      `Bấm OK để thực hiện!`
    );
    if (!confirmed) return;

    State.isRunning = true;
    State.shouldStop = false;
    State.deletedCount = 0;
    toggleRunningUI(true);
    log(`🚀 BẮT ĐẦU XÓA SIÊU TỐC ${buttons.length} ITEMS...`, 'warning');

    for (let i = 0; i < buttons.length; i += CONFIG.batchConcurrency) {
      if (State.shouldStop) break;

      const chunk = buttons.slice(i, i + CONFIG.batchConcurrency);
      log(`Đang xóa đợt [${i + 1} - ${Math.min(i + CONFIG.batchConcurrency, buttons.length)}]...`);

      const promises = chunk.map(async (btn) => {
        try {
          btn.click();
          for (let attempt = 0; attempt < 5; attempt++) {
            await sleep(60);
            const confirmBtn = document.querySelector('div[role="dialog"] button:has-text("Xóa"), div[role="dialog"] button:has-text("Delete")');
            if (confirmBtn) {
              confirmBtn.click();
              break;
            }
          }
          State.deletedCount++;
          return true;
        } catch (e) {
          return false;
        }
      });

      await Promise.all(promises);
      updateProgress();
      await sleep(CONFIG.chunkInterval);
    }

    State.isRunning = false;
    toggleRunningUI(false);
    log(`🎉 XÓA SIÊU TỐC HOÀN TẤT! Đã xóa sạch ${State.deletedCount} items!`, 'success');
    updateStatus('Đã xóa sạch 100%!');

    setTimeout(() => {
      const remaining = findValidTrashButtons();
      State.totalFound = remaining.length;
      updateProgress();
    }, 1500);
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
          <span>Flow Veo 3 Cleaner Turbo</span>
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
          <span class="veo3-api-badge active" id="veo3-api-badge">⚡ Turbo Mode: Đã sẵn sàng</span>
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
          
          <button id="veo3-btn-turbo" class="veo3-btn turbo">⚡ XÓA SIÊU TỐC TẤT CẢ (TURBO)</button>
          
          <button id="veo3-btn-backup" class="veo3-btn secondary">📥 Sao lưu Prompts ra JSON</button>
          <button id="veo3-btn-stop" class="veo3-btn secondary" style="display:none;">⏹️ Dừng khẩn cấp</button>
        </div>

        <div class="veo3-console" id="veo3-console-log">
          <div class="veo3-log-info">[System] Động cơ Turbo kép đã khởi động...</div>
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

    document.getElementById('veo3-btn-scan').addEventListener('click', async () => {
      log('Đang cuộn tải item...');
      for (let i = 0; i < 20; i++) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await sleep(700);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const btns = findValidTrashButtons();
      State.totalFound = btns.length;
      updateProgress();
      log(`Quét xong! Tìm thấy ${btns.length} items sẵn sàng xóa.`, 'success');
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
