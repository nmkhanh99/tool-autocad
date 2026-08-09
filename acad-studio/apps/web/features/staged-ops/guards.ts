/** Câu chữ cho mọi mã lỗi có kiểu mà daemon phát ra.
 *
 * Bộ mẫu thiết kế liệt kê 11 mã. Daemon thật phát 62 — trong đó bốn mã mà màn
 * "Thay đổi chờ duyệt" sẽ gặp nhiều nhất khi apply một thao tác cũ
 * (`operation_expired`, `operation_not_found`, `operation_not_pending`,
 * `operation_revision_mismatch`) không có trong danh sách của mẫu.
 * `scripts/extract-guard-codes.mjs` chặn cả hai chiều: mã daemon phát mà đây
 * chưa có thái độ thì fail, và entry ở đây cho mã daemon không còn phát cũng
 * fail (câu chữ chết còn tệ hơn không có).
 *
 * Nguyên tắc viết: nói CHUYỆN GÌ ĐÃ XẢY RA chứ không nhắc lại mã lỗi; giải
 * thích ngắn; và luôn có bước tiếp theo, kể cả khi bước đó là "chuẩn bị lại".
 * Không xin lỗi, không đổ lỗi cho người dùng.
 */
export type Guard = {
  /** Một câu, thì quá khứ, mô tả điều đã xảy ra. */
  title: string;
  /** Vì sao lại thế — bối cảnh đủ để người dùng tin là app không hỏng. */
  why: string;
  /** Làm gì tiếp. */
  fix: string;
};

export const guards: Record<string, Guard> = {
  /* ---- Hai pha: chuẩn bị → xác nhận ---- */
  confirmation_required: {
    title: "Thao tác này cần được xác nhận trước khi ghi",
    why: "Mọi lệnh ghi vào bản vẽ đều dừng lại chờ người xem trước khi chạy.",
    fix: "Mở thao tác đang chờ, đọc danh sách đối tượng rồi bấm xác nhận.",
  },
  operation_expired: {
    title: "Thao tác đã chuẩn bị quá lâu và bị huỷ",
    why: "Thao tác chờ xác nhận chỉ sống trong thời gian ngắn để không ghi đè lên một bản vẽ đã đổi.",
    fix: "Chuẩn bị lại từ màn hình gốc. Không có cách nào khôi phục thao tác cũ.",
  },
  operation_not_found: {
    title: "Không còn thao tác nào mang mã này",
    why: "Máy chủ không lưu thao tác đã chuẩn bị xuống đĩa — khởi động lại daemon là mất sạch.",
    fix: "Chuẩn bị lại từ màn hình gốc.",
  },
  operation_not_pending: {
    title: "Thao tác này đã được xử lý rồi",
    why: "Mỗi thao tác chỉ ghi được một lần; nó đã ghi xong hoặc đã bị bỏ.",
    fix: "Nếu vẫn cần, chuẩn bị một thao tác mới.",
  },
  operation_revision_mismatch: {
    title: "Bản vẽ đã đổi kể từ lúc chuẩn bị",
    why: "Danh sách đối tượng bạn đã xem không còn đúng với bản vẽ hiện tại.",
    fix: "Bỏ thao tác này và chuẩn bị lại để xem đúng những gì sắp bị thay đổi.",
  },

  /* ---- Bản vẽ đã đổi ---- */
  document_stale: {
    title: "Bản vẽ đã thay đổi",
    why: "Ai đó hoặc chính bạn đã sửa bản vẽ sau khi app đọc nó.",
    fix: "Quét lại từ AutoCAD rồi thực hiện lại thao tác.",
  },
  drawing_stale: {
    title: "Bản vẽ đã thay đổi",
    why: "Revision của bản vẽ trong AutoCAD không còn khớp với lúc app đọc.",
    fix: "Quét lại từ AutoCAD rồi thực hiện lại thao tác.",
  },
  scope_stale: {
    title: "Phạm vi đã chọn không còn đúng",
    why: "Layer hoặc block dùng làm phạm vi đã đổi trong bản vẽ.",
    fix: "Chọn lại phạm vi từ danh mục vừa quét.",
  },
  selection_stale: {
    title: "Bộ chọn không còn đúng",
    why: "Các đối tượng đã chọn đã bị sửa hoặc xoá trong AutoCAD.",
    fix: "Chọn lại rồi chuẩn bị thao tác mới.",
  },
  destination_stale: {
    title: "Layer đích đã đổi",
    why: "Layer nhận đối tượng không còn như lúc chuẩn bị.",
    fix: "Quét lại danh sách layer rồi chọn lại đích.",
  },
  target_mismatch: {
    title: "Thao tác thuộc về một bản vẽ khác",
    why: "Bản vẽ đang hoạt động đã đổi giữa lúc chuẩn bị và lúc xác nhận.",
    fix: "Kích hoạt đúng bản vẽ rồi chuẩn bị lại.",
  },
  profile_stale: {
    title: "Hồ sơ tiêu chuẩn đã được sửa",
    why: "Kết quả quét dựa trên phiên bản hồ sơ cũ nên không còn dùng được.",
    fix: "Quét lại bản vẽ với hồ sơ hiện tại.",
  },
  scan_expired: {
    title: "Phiên quét đã hết hạn",
    why: "Kết quả quét chỉ sống trong phiên làm việc và bị huỷ sau khi áp dụng.",
    fix: "Quét lại bản vẽ.",
  },
  drawing_revision_unavailable: {
    title: "Không đọc được revision của bản vẽ",
    why: "Không có revision thì app không đảm bảo được là ghi đúng vào bản vẽ đã xem.",
    fix: "Kiểm tra plugin AcadBridge còn phản hồi, rồi quét lại.",
  },
  revision_conflict: {
    title: "Tài nguyên đã được sửa ở nơi khác",
    why: "Có thay đổi khác được lưu trước thay đổi của bạn.",
    fix: "Nạp lại bản mới nhất rồi áp dụng lại thay đổi của bạn.",
  },
  block_library_revision_conflict: {
    title: "Thư viện block đã được sửa ở nơi khác",
    why: "Danh mục block đã đổi kể từ lúc màn hình này nạp nó.",
    fix: "Nạp lại thư viện rồi thực hiện lại. Không có ghi đè cưỡng bức.",
  },
  standards_revision_conflict: {
    title: "Hồ sơ tiêu chuẩn đã được sửa ở nơi khác",
    why: "Một phiên khác đã lưu hồ sơ này trước bạn.",
    fix: "Nạp lại hồ sơ, đối chiếu rồi nhập lại thay đổi. Không có ghi đè cưỡng bức.",
  },

  /* ---- Đích bản vẽ ---- */
  target_ambiguous: {
    title: "Có nhiều bản vẽ trùng tên đang mở",
    why: "App không đoán bản vẽ nào — đoán sai nghĩa là ghi nhầm tệp.",
    fix: "Chọn bản vẽ bằng đường dẫn đầy đủ thay vì tên.",
  },
  target_not_found: {
    title: "Bản vẽ không còn mở trong AutoCAD",
    why: "Danh sách bản vẽ chỉ gồm tệp đang mở; tệp này đã bị đóng.",
    fix: "Mở lại bản vẽ trong AutoCAD rồi nạp lại danh sách.",
  },
  target_not_active: {
    title: "Bản vẽ này không phải bản vẽ đang hoạt động",
    why: "Thao tác chỉ chạy được trên bản vẽ đang hoạt động trong AutoCAD.",
    fix: "Kích hoạt bản vẽ trước, rồi thực hiện lại thao tác.",
  },
  target_busy: {
    title: "Bản vẽ đang bận",
    why: "AutoCAD đang chạy một lệnh khác trên tệp này.",
    fix: "Đợi lệnh trong AutoCAD kết thúc rồi thử lại.",
  },
  active_document_ambiguous: {
    title: "Không xác định được bản vẽ đang hoạt động",
    why: "AutoCAD báo về nhiều bản vẽ cùng ở trạng thái hoạt động.",
    fix: "Bấm vào cửa sổ bản vẽ muốn dùng trong AutoCAD, rồi nạp lại danh sách.",
  },
  active_document_not_found: {
    title: "AutoCAD không mở bản vẽ nào",
    why: "Thao tác cần một bản vẽ đang hoạt động.",
    fix: "Mở một bản vẽ trong AutoCAD rồi thử lại.",
  },
  drawing_not_active: {
    title: "Bản vẽ chưa được kích hoạt",
    why: "Quét và sửa tiêu chuẩn chỉ chạy trên bản vẽ đang hoạt động.",
    fix: "Kích hoạt bản vẽ rồi quét lại.",
  },
  drawing_busy: {
    title: "AutoCAD đang bận",
    why: "Có lệnh hoặc hộp thoại đang mở nên bản vẽ chưa ở trạng thái đọc được.",
    fix: "Đóng hộp thoại hoặc kết thúc lệnh trong AutoCAD, rồi thử lại.",
  },
  drawing_read_only: {
    title: "Bản vẽ đang ở chế độ chỉ đọc",
    why: "Tệp mở read-only, hoặc đang bị một phiên khác giữ.",
    fix: "Mở lại bản vẽ với quyền ghi trong AutoCAD.",
  },

  /* ---- Bộ chọn ---- */
  selection_empty: {
    title: "Không có đối tượng nào khớp",
    why: "Phạm vi đã chọn không chứa đối tượng nào trong không gian hiện tại.",
    fix: "Đổi phạm vi, hoặc kiểm tra xem đang ở Model hay Layout.",
  },
  selection_too_large: {
    title: "Bộ chọn vượt giới hạn 5.000 đối tượng",
    why: "Giới hạn này giữ cho AutoCAD không treo giữa chừng một thao tác không hoàn tác được.",
    fix: "Thu hẹp phạm vi rồi chia thành nhiều đợt.",
  },
  no_change: {
    title: "Thao tác không thay đổi gì",
    why: "Các đối tượng đã ở đúng trạng thái mà thao tác muốn đưa chúng tới.",
    fix: "Không cần làm gì thêm.",
  },
  layer_not_found: {
    title: "Layer không tồn tại trong bản vẽ",
    why: "Layer đích đã bị xoá hoặc đổi tên.",
    fix: "Quét lại danh sách layer rồi chọn lại.",
  },
  layer_unavailable: {
    title: "Layer đang khoá hoặc đóng băng",
    why: "AutoCAD không cho ghi vào layer ở trạng thái này.",
    fix: "Mở khoá layer trong AutoCAD rồi thử lại.",
  },
  selection_internal_error: {
    title: "Lỗi khi đọc bộ chọn",
    why: "Plugin trả về dữ liệu app không hiểu được. Bản vẽ chưa bị thay đổi.",
    fix: "Thử lại; nếu lặp lại, xem nhật ký hoạt động và trạng thái plugin.",
  },

  /* ---- AutoCAD và plugin ---- */
  not_running: {
    title: "AutoCAD chưa chạy",
    why: "Thao tác này cần một phiên AutoCAD đang mở.",
    fix: "Mở AutoCAD rồi thử lại.",
  },
  not_found: {
    title: "Chưa cài AutoCAD trên máy này",
    why: "App không tìm thấy AutoCAD ở các vị trí cài đặt tiêu chuẩn.",
    fix: "Cài AutoCAD, hoặc dùng các chức năng offline không cần AutoCAD.",
  },
  plugin_unavailable: {
    title: "Plugin AcadBridge chưa nạp",
    why: "Không có plugin thì app không đọc hay ghi được vào bản vẽ đang mở.",
    fix: "Gõ APPLOAD trong AutoCAD và nạp Acad-Bridge.bundle.",
  },
  plugin_update_required: {
    title: "Plugin AcadBridge quá cũ",
    why: "Bản plugin đang chạy không có năng lực mà thao tác này cần.",
    fix: "Build lại plugin rồi khởi động lại AutoCAD — AutoCAD không nạp lại bundle giữa phiên.",
  },
  timeout: {
    title: "AutoCAD không trả lời kịp",
    why: "Lệnh chạy quá lâu, thường vì bản vẽ lớn hoặc có hộp thoại đang chờ.",
    fix: "Kiểm tra cửa sổ AutoCAD xem có gì đang chờ, rồi thử lại.",
  },

  /* ---- In ấn ---- */
  invalid_plot_config: {
    title: "Cấu hình in không hợp lệ",
    why: "Có trường vượt ngoài danh sách mà kênh in chấp nhận.",
    fix: "Dùng Page Setup đã lưu trong bản vẽ thay vì tự nhập từng tham số.",
  },
  layout_not_found: {
    title: "Không có layout mang tên này",
    why: "Layout đã bị xoá hoặc đổi tên trong bản vẽ.",
    fix: "Nạp lại danh sách layout rồi chọn lại.",
  },
  layout_snapshot_unavailable: {
    title: "Không đọc được thông tin layout",
    why: "Plugin không trả về được cấu hình trang của layout này.",
    fix: "Mở layout một lần trong AutoCAD rồi thử lại.",
  },
  plot_failed: {
    title: "AutoCAD không in được",
    why: "Lệnh in kết thúc với lỗi. Không có tệp PDF nào được tạo.",
    fix: "Kiểm tra thiết bị in và bảng kiểu nét trong AutoCAD, rồi thử lại.",
  },
  plot_timeout_uncertain: {
    title: "Lệnh in quá giờ — chưa rõ kết quả",
    why: "AutoCAD chưa báo xong. Tệp PDF có thể đã được tạo, có thể chưa.",
    fix: "Kiểm tra thư mục xuất trước khi in lại, để tránh tạo hai tệp.",
  },
  dedicated_endpoint_required: {
    title: "Năng lực này phải gọi qua màn hình riêng",
    why: "Đường gọi thô bị chặn để lệnh ghi không đi vòng qua bước xác nhận.",
    fix: "Dùng màn hình tương ứng cho thao tác này.",
  },

  /* ---- Thư viện LISP ---- */
  user_review_challenge_required: {
    title: "Cần duyệt script trước khi nạp",
    why: "Script LISP chạy được lệnh tuỳ ý trong AutoCAD nên phải có người đọc và duyệt.",
    fix: "Mở phần duyệt, đọc phân tích rồi xác nhận.",
  },
  invalid_approval_challenge: {
    title: "Phiếu duyệt không hợp lệ hoặc đã hết hạn",
    why: "Phiếu duyệt chỉ sống hai phút để nó không thể dùng lại cho một script khác.",
    fix: "Duyệt lại script từ đầu.",
  },
  desktop_user_review_proof_required: {
    title: "Việc duyệt phải thực hiện trong ứng dụng desktop",
    why: "Bằng chứng duyệt phải đến từ một thao tác của người thật, không từ lời gọi API.",
    fix: "Mở ứng dụng desktop và duyệt script ở đó.",
  },
  resource_not_found: {
    title: "Không tìm thấy tài nguyên LISP",
    why: "Tệp đã bị xoá hoặc di chuyển khỏi thư mục nguồn.",
    fix: "Nạp lại thư viện.",
  },

  /* ---- Khác ---- */
  standards_validation_error: {
    title: "Hồ sơ tiêu chuẩn có giá trị không hợp lệ",
    why: "Một trường trong hồ sơ không đúng định dạng nên chưa lưu được.",
    fix: "Sửa trường được báo rồi lưu lại.",
  },
  block_library_validation_error: {
    title: "Dữ liệu block không hợp lệ",
    why: "Một trường của block không đúng định dạng nên chưa lưu được.",
    fix: "Sửa trường được báo rồi lưu lại.",
  },
  sync_run_failed: {
    title: "Đồng bộ CadWeb thất bại",
    why: "Không gửi được snapshot lên máy chủ.",
    fix: "Xem trạng thái đồng bộ; hiện chưa có máy chủ nào nhận nên tính năng này còn tắt.",
  },
  origin_not_allowed: {
    title: "Daemon từ chối yêu cầu từ nguồn này",
    why: "Daemon chạy được AutoLISP nên chỉ nhận yêu cầu từ giao diện của chính nó.",
    fix: "Mở app qua http://localhost:3000 hoặc qua daemon, không mở tệp HTML bằng file://.",
  },
};

/** Có câu chữ riêng cho mã này không? Không có thì hiển thị message thô của
 * daemon — vẫn tốt hơn một câu chung chung sai bối cảnh. */
export function guardFor(code: string): Guard | null {
  return guards[code] || null;
}
