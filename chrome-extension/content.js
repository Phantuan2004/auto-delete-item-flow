/**
 * Google Flow (Veo 3) - Bulk Item Cleaner & Backup Tool
 * Engine v1.3.1 - Bổ sung nút Tắt hẳn (Close) & Mini Reopen Pill
 */

(function () {
  'use strict';

  if (window.__VEO3_CLEANER_INITIALIZED__) {
    const existing = document.getElementById('veo3-cleaner-widget');
    if (existing) existing.style.display = 'block';
    const pill = document.getElementById('veo3-reopen-pill');
    if (pill) pill.style.display = 'none';
    return;
  }
  window.__VEO3_CLEANER_INITIALIZED__ = true;

  // =========================================================================
  // 1. CONFIGURATION & SELECTORS
  // =========================================================================
  const CONFIG = {
    minDelay: 600,
    maxDelay: 1100,
    modalWaitTimeout: 3000,
    skipCollections: true,
    customTrashSelector: null,

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
      'button:has(svg path[d*="M3 6h18"])',
      'button:has(span.material-icons:contains("delete"))'
    ],

    collectionKeywords: /(bộ sưu tập|collection|album|tập hợp|danh sách kết hợp|series)/i,
    confirmKeywords: /^(xóa|delete|confirm|remove)$/i,
    cancelKeywords: /^(hủy|cancel|keep|đóng|close)$/i
  };

  const State = {
    isRunning: false,
    isPaused: false,
    shouldStop: false,
    totalFound: 0,
    deletedCount: 0,
    skippedCollections: 0,
    failedCount: 0,
    pickerActive: false
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getRandomDelay = () => Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay)) + CONFIG.minDelay;

  // =========================================================================
  // 2. BỘ LỌC THÔNG MINH BỎ QUA BỘ SƯU TẬP
  // =========================================================================
  function isBelongToCollection(element) {
    if (!CONFIG.skipCollections) return false;

    const card = element.closest('div[role="listitem"], div[role="gridcell"], section, article') || element.parentElement?.parentElement;
    if (!card) return false;

    const cardText = card.innerText || '';
    const firstLines = cardText.slice(0, 300);
    if (CONFIG.collectionKeywords.test(firstLines)) {
      return true;
    }

    const attrString = (card.className + ' ' + (card.getAttribute('data-type') || '') + ' ' + (card.getAttribute('aria-label') || '')).toLowerCase();
    if (CONFIG.collectionKeywords.test(attrString)) {
      return true;
    }

    const mediaCount = card.querySelectorAll('video, img[src*="googleusercontent"]').length;
    if (mediaCount > 2 && element.parentElement.tagName !== 'DIV') {
      return true;
    }

    return false;
  }

  function findValidTrashButtons() {
    let candidateButtons = new Set();

    if (CONFIG.customTrashSelector) {
      document.querySelectorAll(CONFIG.customTrashSelector).forEach(b => candidateButtons.add(b));
    } else {
      for (const sel of CONFIG.trashSelectors) {
        try {
          const btns = document.querySelectorAll(sel);
          btns.forEach(b => candidateButtons.add(b));
        } catch (e) {}
      }

      const downloadOrShareBtns = document.querySelectorAll('button:has(svg)');
      downloadOrShareBtns.forEach(btn => {
        const parentBar = btn.parentElement;
        if (parentBar && parentBar.children.length >= 2 && !parentBar.closest('#veo3-cleaner-widget')) {
          const btns = parentBar.querySelectorAll('button');
          btns.forEach(b => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const title = (b.getAttribute('title') || '').toLowerCase();
            if (aria.includes('xóa') || aria.includes('delete') || title.includes('xóa') || title.includes('delete')) {
              candidateButtons.add(b);
            }
          });
        }
      });
    }

    const validButtons = [];
    let skippedCount = 0;

    candidateButtons.forEach(btn => {
      if (btn.closest('#veo3-cleaner-widget') || !isVisible(btn)) return;

      if (isBelongToCollection(btn)) {
        skippedCount++;
        return;
      }

      validButtons.push(btn);
    });

    State.skippedCollections = skippedCount;
    return validButtons;
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // =========================================================================
  // 3. CORE ACTION: XÓA ITEM
  // =========================================================================
  async function handleConfirmModalIfAny() {
    const startTime = Date.now();
    while (Date.now() - startTime < 1500) {
      const dialog = document.querySelector('div[role="dialog"], div[role="alertdialog"], .modal, .dialog');
      if (dialog && isVisible(dialog)) {
        const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
        for (const btn of buttons) {
          const text = btn.textContent.trim();
          if (
            CONFIG.confirmKeywords.test(text) ||
            (/xóa|delete|confirm|đồng ý/i.test(text) && !CONFIG.cancelKeywords.test(text))
          ) {
            btn.click();
            log('Đã tự động xác nhận popup xóa.', 'info');
            return true;
          }
        }
      }
      await sleep(150);
    }
    return false;
  }

  async function deleteSingleItemByTrash(trashBtn, index) {
    log(`[#${index + 1}] Bấm icon thùng rác...`);

    trashBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);

    trashBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    trashBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(100);
    trashBtn.click();

    await handleConfirmModalIfAny();
    await sleep(getRandomDelay());
    return true;
  }

  async function runBulkDelete() {
    if (State.isRunning) return;

    const confirmed = confirm(
      `⚠️ CẢNH BÁO AN TOÀN FLOW VEO 3:\n\n` +
      `Bạn có chắc chắn muốn xóa TOÀN BỘ video và hình ảnh con trong dự án này?\n` +
      `(Hệ thống sẽ TỰ ĐỘNG BỎ QUA các Bộ Sưu Tập lớn để bảo vệ dữ liệu).\n\n` +
      `Thao tác này KHÔNG THỂ HOÀN TÁC!`
    );
    if (!confirmed) {
      log('Đã hủy thao tác xóa.', 'info');
      return;
    }

    State.isRunning = true;
    State.isPaused = false;
    State.shouldStop = false;
    State.deletedCount = 0;
    State.failedCount = 0;

    toggleRunningUI(true);
    log('Bắt đầu xóa tự động qua nút Thùng rác...', 'warning');

    while (!State.shouldStop) {
      while (State.isPaused && !State.shouldStop) {
        updateStatus('Đang tạm dừng...');
        await sleep(500);
      }

      if (State.shouldStop) break;

      const trashBtns = findValidTrashButtons().filter(b => !b.hasAttribute('data-veo3-skipped'));
      State.totalFound = trashBtns.length;
      updateProgress();

      if (trashBtns.length === 0) {
        log('Kiểm tra cuộn nạp thêm item...', 'info');
        window.scrollBy({ top: 550, behavior: 'smooth' });
        await sleep(1400);

        const recheck = findValidTrashButtons().filter(b => !b.hasAttribute('data-veo3-skipped'));
        if (recheck.length === 0) {
          log('🎉 HOÀN TẤT: Đã xóa toàn bộ ảnh & video con!', 'success');
          if (State.skippedCollections > 0) {
            log(`🛡️ Đã bảo vệ an toàn ${State.skippedCollections} Bộ sưu tập.`, 'info');
          }
          updateStatus('Đã hoàn thành 100%!');
          break;
        }
      }

      const targetBtn = trashBtns[0];
      try {
        const success = await deleteSingleItemByTrash(targetBtn, State.deletedCount);
        if (success) {
          State.deletedCount++;
          log(`✅ Đã xóa ${State.deletedCount} items`, 'success');
        } else {
          State.failedCount++;
          targetBtn.setAttribute('data-veo3-skipped', 'true');
        }
      } catch (err) {
        log(`❌ Lỗi thao tác: ${err.message}`, 'error');
        targetBtn.setAttribute('data-veo3-skipped', 'true');
      }

      updateProgress();
    }

    State.isRunning = false;
    toggleRunningUI(false);
    log(`Kết thúc: Đã xóa ${State.deletedCount} items | Đã giữ lại ${State.skippedCollections} Bộ sưu tập`);
  }

  // =========================================================================
  // 4. SCANNER, PICKER & BACKUP
  // =========================================================================
  async function scanAndScrollAll() {
    log('Bắt đầu cuộn trang để quét toàn bộ item...', 'info');
    updateStatus('Đang quét item...');

    let lastCount = 0;
    let stableTimes = 0;

    for (let i = 0; i < 25; i++) {
      if (State.shouldStop) break;

      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await sleep(900);

      const trashBtns = findValidTrashButtons();
      State.totalFound = trashBtns.length;
      updateProgress();
      log(`Tìm thấy: ${trashBtns.length} video/ảnh con (Đã bỏ qua bộ sưu tập)`);

      if (trashBtns.length === lastCount && trashBtns.length > 0) {
        stableTimes++;
        if (stableTimes >= 3) {
          log('Đã cuộn đến cuối trang!', 'success');
          break;
        }
      } else {
        stableTimes = 0;
      }
      lastCount = trashBtns.length;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateStatus(`Quét xong. Tìm thấy ${State.totalFound} items.`);
  }

  function exportProjectBackup() {
    log('Đang trích xuất danh sách prompts và assets...', 'info');
    const items = [];

    const mediaElements = document.querySelectorAll('video, img[src*="googleusercontent"]');
    mediaElements.forEach((el, idx) => {
      let card = el.closest('div[role="gridcell"], div[role="listitem"]') || el.parentElement?.parentElement?.parentElement;
      if (!card || card.closest('#veo3-cleaner-widget')) return;

      const isColl = isBelongToCollection(el);
      const promptText = card.innerText || '';
      const src = el.tagName === 'VIDEO' ? el.currentSrc || el.src : el.src;

      items.push({
        index: idx + 1,
        isCollection: isColl,
        type: el.tagName.toLowerCase(),
        src: src,
        content: promptText.trim().replace(/\n+/g, ' | ')
      });
    });

    if (items.length === 0) {
      log('Chưa tìm thấy dữ liệu. Hãy bấm "Quét & Cuộn" trước!', 'warning');
      return;
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `flow_veo3_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    log(`✅ Đã xuất file sao lưu với ${items.length} items!`, 'success');
  }

  function startTrashPicker() {
    if (State.pickerActive) return;
    State.pickerActive = true;

    log('👉 Click trực tiếp vào ICON THÙNG RÁC bất kỳ bên phải video để tiện ích học vị trí!', 'warning');
    updateStatus('Chế độ chọn: Click vào icon thùng rác...');

    let hoveredEl = null;

    const onMouseOver = (e) => {
      if (e.target.closest('#veo3-cleaner-widget')) return;
      if (hoveredEl) hoveredEl.classList.remove('veo3-highlight-target');
      hoveredEl = e.target.closest('button') || e.target;
      hoveredEl.classList.add('veo3-highlight-target');
    };

    const onClick = (e) => {
      if (e.target.closest('#veo3-cleaner-widget')) return;
      e.preventDefault();
      e.stopPropagation();

      const btn = e.target.closest('button') || e.target;
      if (hoveredEl) hoveredEl.classList.remove('veo3-highlight-target');

      let sel = '';
      if (btn.getAttribute('aria-label')) {
        sel = `button[aria-label="${btn.getAttribute('aria-label')}"]`;
      } else if (btn.getAttribute('title')) {
        sel = `button[title="${btn.getAttribute('title')}"]`;
      } else if (btn.className) {
        const cls = Array.from(btn.classList).filter((c) => !c.startsWith('veo3-')).join('.');
        if (cls) sel = `button.${cls}`;
      }
      if (!sel) sel = 'button';

      CONFIG.customTrashSelector = sel;
      log(`🎯 Đã ghi nhận vị trí nút thùng rác: "${sel}"`, 'success');
      updateStatus('Đã lưu nút thùng rác!');

      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);
      State.pickerActive = false;

      const found = findValidTrashButtons();
      State.totalFound = found.length;
      updateProgress();
      log(`Tìm thấy: ${found.length} nút thùng rác tương tự!`, 'success');
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
  }

  // =========================================================================
  // 5. UI CONTROLLER & WIDGET (CÓ NÚT TẮT HẲN VÀ REOPEN PILL)
  // =========================================================================
  function injectUI() {
    if (document.getElementById('veo3-cleaner-widget')) return;

    // 1. Tạo Widget chính
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
          <div class="veo3-actions-row">
            <button id="veo3-btn-scan" class="veo3-btn secondary">🔍 Quét & Cuộn</button>
            <button id="veo3-btn-test-one" class="veo3-btn secondary" title="Xóa thử 1 item bằng nút Thùng rác">🧪 Test 1 item</button>
          </div>
          
          <button id="veo3-btn-backup" class="veo3-btn secondary">📥 Sao lưu Prompts ra JSON</button>
          <button id="veo3-btn-start" class="veo3-btn danger">🗑️ Xóa toàn bộ qua Thùng Rác</button>
          
          <button id="veo3-btn-pause" class="veo3-btn warning" style="display:none;">⏸️ Tạm dừng</button>
          <button id="veo3-btn-stop" class="veo3-btn secondary" style="display:none;">⏹️ Dừng khẩn cấp</button>
          
          <button id="veo3-btn-picker" class="veo3-btn secondary" style="font-size: 11px;">🎯 Chọn thủ công nút Thùng rác</button>
        </div>

        <div class="veo3-console" id="veo3-console-log">
          <div class="veo3-log-info">[System] Sẵn sàng - Nhận diện icon Thùng rác bên phải...</div>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    // 2. Tạo nút Reopen Pill nhỏ gọn khi đã tắt
    const reopenPill = document.createElement('div');
    reopenPill.id = 'veo3-reopen-pill';
    reopenPill.title = 'Nhấp để mở lại Flow Veo 3 Cleaner';
    reopenPill.style.display = 'none';
    reopenPill.innerHTML = `<span>⚡ Flow Cleaner</span>`;
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
    const btnStart = document.getElementById('veo3-btn-start');
    const btnScan = document.getElementById('veo3-btn-scan');
    const btnTestOne = document.getElementById('veo3-btn-test-one');
    const btnBackup = document.getElementById('veo3-btn-backup');
    const btnPicker = document.getElementById('veo3-btn-picker');
    const btnPause = document.getElementById('veo3-btn-pause');
    const btnStop = document.getElementById('veo3-btn-stop');

    if (running) {
      btnStart.style.display = 'none';
      btnScan.style.display = 'none';
      btnTestOne.style.display = 'none';
      btnBackup.style.display = 'none';
      btnPicker.style.display = 'none';
      btnPause.style.display = 'block';
      btnStop.style.display = 'block';
    } else {
      btnStart.style.display = 'block';
      btnScan.style.display = 'block';
      btnTestOne.style.display = 'block';
      btnBackup.style.display = 'block';
      btnPicker.style.display = 'block';
      btnPause.style.display = 'none';
      btnStop.style.display = 'none';
    }
  }

  function bindUIEvents() {
    const widget = document.getElementById('veo3-cleaner-widget');
    const reopenPill = document.getElementById('veo3-reopen-pill');

    // Nút thu nhỏ / mở rộng nội dung body
    const btnMin = document.getElementById('veo3-btn-minimize');
    const bodyContent = document.getElementById('veo3-body-content');
    btnMin.addEventListener('click', () => {
      const isHidden = bodyContent.style.display === 'none';
      bodyContent.style.display = isHidden ? 'block' : 'none';
      btnMin.textContent = isHidden ? '_' : '□';
    });

    // Nút Tắt hẳn tiện ích
    const btnClose = document.getElementById('veo3-btn-close');
    btnClose.addEventListener('click', () => {
      if (State.isRunning) {
        const confirmStop = confirm('Tiện ích đang trong quá trình xóa, bạn có muốn dừng lại và tắt hẳn không?');
        if (!confirmStop) return;
        State.shouldStop = true;
      }
      widget.style.display = 'none';
      if (reopenPill) reopenPill.style.display = 'flex';
      console.log('[Flow Veo 3 Cleaner] Tiện ích đã tắt. Nhấn vào nút "⚡ Flow Cleaner" ở góc dưới để mở lại bất kỳ lúc nào.');
    });

    // Nhấp vào Reopen Pill để mở lại Widget
    if (reopenPill) {
      reopenPill.addEventListener('click', () => {
        widget.style.display = 'block';
        reopenPill.style.display = 'none';
      });
    }

    // Checkbox bảo vệ bộ sưu tập
    const chkSkip = document.getElementById('veo3-chk-skip-collections');
    chkSkip.addEventListener('change', (e) => {
      CONFIG.skipCollections = e.target.checked;
      log(CONFIG.skipCollections ? 'Đã BẬT bảo vệ Bộ sưu tập' : '⚠️ Đã TẮT bảo vệ Bộ sưu tập', 'warning');
      const found = findValidTrashButtons();
      State.totalFound = found.length;
      updateProgress();
    });

    document.getElementById('veo3-btn-scan').addEventListener('click', () => {
      scanAndScrollAll();
    });

    document.getElementById('veo3-btn-backup').addEventListener('click', () => {
      exportProjectBackup();
    });

    document.getElementById('veo3-btn-test-one').addEventListener('click', async () => {
      const trashBtns = findValidTrashButtons();
      if (trashBtns.length === 0) {
        log('Không tìm thấy nút Thùng rác nào! Hãy bấm "Quét & Cuộn" hoặc "Chọn thủ công".', 'warning');
        return;
      }
      log('Bắt đầu thử nghiệm xóa 1 item bằng nút Thùng rác...');
      await deleteSingleItemByTrash(trashBtns[0], 0);
      const remaining = findValidTrashButtons();
      State.totalFound = remaining.length;
      updateProgress();
    });

    document.getElementById('veo3-btn-start').addEventListener('click', () => {
      runBulkDelete();
    });

    const btnPause = document.getElementById('veo3-btn-pause');
    btnPause.addEventListener('click', () => {
      State.isPaused = !State.isPaused;
      btnPause.textContent = State.isPaused ? '▶️ Tiếp tục' : '⏸️ Tạm dừng';
      log(State.isPaused ? 'Đã tạm dừng.' : 'Tiếp tục xóa.');
    });

    document.getElementById('veo3-btn-stop').addEventListener('click', () => {
      State.shouldStop = true;
      log('Đã gửi lệnh DỪNG KHẨN CẤP!', 'warning');
      updateStatus('Đang dừng lại...');
    });

    document.getElementById('veo3-btn-picker').addEventListener('click', () => {
      startTrashPicker();
    });
  }

  function setupDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = `${element.offsetTop - pos2}px`;
      element.style.left = `${element.offsetLeft - pos1}px`;
      element.style.bottom = 'auto';
      element.style.right = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(injectUI, 1200);
  } else {
    window.addEventListener('load', () => setTimeout(injectUI, 1200));
  }
})();
