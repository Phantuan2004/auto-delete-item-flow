# ⚡ Google Flow (Veo 3) - Bulk Item Cleaner & Backup Tool (v1.3.0)

Tiện ích JavaScript chuyên dụng giúp tự động dọn dẹp và xóa toàn bộ các item video/ảnh con trong dự án đang mở trên nền tảng **Google Flow / Veo 3** (`https://flow.google.com/`).

---

## 🌟 Cải tiến mới trong phiên bản 1.3.0

1. **🗑️ Xóa trực tiếp qua icon Thùng rác bên phải:** 
   - Nhận diện và click thẳng vào nút Thùng rác (Trash Can) nằm bên phải mỗi video/ảnh (cạnh nút Tải xuống & Chia sẻ).
   - Không cần mở menu 3 chấm, tăng tốc độ xóa gấp 3 lần và loại bỏ hoàn toàn hiện tượng nhấp nháy menu.
2. **🛡️ Tự động bảo vệ & Bỏ qua Bộ sưu tập (Collections):**
   - Hệ thống tự động phân biệt giữa **item con** (từng ảnh / video đơn lẻ) và **item lớn** (Bộ sưu tập / Albums / Collections).
   - Tự động bỏ qua không xóa các Bộ sưu tập lớn, đảm bảo dự án không bị mất các cấu trúc quan trọng.
   - Có tùy chọn checkbox bật/tắt: `[x] Bỏ qua & Giữ lại Bộ sưu tập`.
3. **📥 Sao lưu dự phòng Prompts & URLs:** 
   - Nút **"Sao lưu Prompts ra JSON"** cho phép trích xuất toàn bộ prompt text và link media trước khi xóa.
4. **🎯 Bộ chọn thủ công nút Thùng rác (Trash Picker):**
   - Nếu Google có cập nhật giao diện, chỉ cần bấm nút này rồi click vào bất kỳ icon thùng rác nào trên màn hình, tiện ích sẽ tự học và ghi nhớ vị trí ngay lập tức.

---

## 🚀 Hướng dẫn cài đặt & Sử dụng

### Cách 1: Sử dụng qua Tampermonkey (Khuyên dùng)
1. Cài đặt tiện ích [Tampermonkey](https://www.tampermonkey.net/) trên Chrome/Edge.
2. Mở file [`flow_veo3_cleaner.user.js`](./flow_veo3_cleaner.user.js) -> Copy toàn bộ code.
3. Vào Tampermonkey -> **Create a new script** -> Dán đè vào và nhấn `Ctrl + S`.
4. Mở [flow.google.com](https://flow.google.com/) và tải lại trang.

### Cách 2: Cài dạng Chrome Extension (Manifest V3)
1. Mở `chrome://extensions/` trên Chrome/Edge.
2. Bật **Developer mode** ở góc phải trên.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục:
   `...\delete item flow veo 3\chrome-extension`
4. Mở [flow.google.com](https://flow.google.com/) và sử dụng.

---

## 📋 Quy trình dọn dẹp khuyến nghị

1. Mở dự án cần dọn trên **https://flow.google.com/**.
2. Bấm **"🔍 Quét & Cuộn"**: Chờ trang cuộn để tải đủ các item con.
3. Bấm **"📥 Sao lưu Prompts ra JSON"** (Tùy chọn) để lưu lại danh sách prompts nếu cần.
4. Bấm **"🧪 Test 1 item"**: Kiểm tra xem tiện ích click vào nút thùng rác bên phải và xác nhận popup thành công không.
5. Bấm **"🗑️ Xóa toàn bộ qua Thùng Rác"** để bắt đầu quy trình dọn dẹp tự động.
