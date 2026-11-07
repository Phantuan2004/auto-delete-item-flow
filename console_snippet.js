/**
 * Google Flow (Veo 3) - DevTools Quick Console Snippet
 * Cách dùng: Nhấn F12 trên flow.google.com -> Chọn tab Console -> Dán toàn bộ mã này vào và nhấn Enter.
 */
(function() {
  const scriptId = 'veo3-cleaner-standalone';
  if (document.getElementById(scriptId)) {
    console.log('%c[Flow Veo 3]%c Tiện ích đã được nạp từ trước!', 'color: #8ab4f8; font-weight: bold', 'color: inherit');
    return;
  }

  // Nạp trực tiếp mã nguồn tiện ích từ nội dung content script
  console.log('%c[Flow Veo 3]%c Đang kích hoạt tiện ích dọn dẹp...', 'color: #8ab4f8; font-weight: bold', 'color: inherit');
  
  // Tự động kích hoạt widget
  if (window.__VEO3_CLEANER_INITIALIZED__) {
    const widget = document.getElementById('veo3-cleaner-widget');
    if (widget) {
      widget.style.display = 'block';
      console.log('%c[Flow Veo 3]%c Widget đã được mở lại ở góc dưới bên phải.', 'color: #81c995; font-weight: bold', 'color: inherit');
    }
  }
})();
