"use client";

/** Dải cảnh báo cho màn hình **chưa có backend**.
 *
 * Không tắt được, và đó là chủ ý — quyết định D2 của `ROADMAP.md`.
 *
 * ## Vì sao nó phải tồn tại
 *
 * Hai màn hình của app hiện ra như đã hoàn thiện nhưng **mọi con số đều là hằng
 * số viết cứng**: `PreconstructionWorkspace` không gọi một API nào, còn
 * `PDF & Review Workspace` gọi đúng một lời gọi để đọc `INSUNITS` — diện tích,
 * chiều dài, danh sách tài liệu, danh sách markup, cả bản vẽ trong khung xem đều
 * là dữ liệu mẫu.
 *
 * Một kỹ sư mở màn hình đó ra, thấy "18,60 m²" cạnh một mặt bằng, và không có
 * gì trên màn hình nói rằng con số ấy không đến từ bản vẽ của họ. Đó không phải
 * một tính năng chưa xong — đó là một màn hình **nói dối**, và nó nguy hiểm hơn
 * một màn hình trống.
 *
 * ## Vì sao KHÔNG cho tắt
 *
 * Cho tắt là biến nó thành một cú bấm phiền toái người ta bỏ qua trong ba giây
 * đầu, rồi ba tháng sau chép số vào hồ sơ thầu. Ma sát ở đây là mục đích, không
 * phải tác dụng phụ.
 *
 * ## Điều kiện gỡ
 *
 * Chỉ gỡ khi màn hình đó có endpoint thật. Không gỡ vì "trông xấu", không gỡ vì
 * "ai cũng biết rồi". Xem `ROADMAP.md` mục nợ kỹ thuật.
 */
export function PrototypeBanner({
  what,
  real = "",
}: {
  /** Màn hình này lẽ ra làm gì — viết theo cách người dùng nghĩ về nó. */
  what: string;
  /** Phần DUY NHẤT là dữ liệu thật, nếu có. Rỗng nghĩa là không có gì thật. */
  real?: string;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "9px 16px",
        background: "#7a2e00",
        color: "#ffe9d6",
        fontSize: 12.5,
        lineHeight: 1.5,
        borderBottom: "1px solid #a34400",
        /* Không cho co lại: trong một flex column, dải này bị ép mỏng đi cho tới
           khi chữ biến mất, và cảnh báo biến mất là mất luôn lý do nó tồn tại. */
        flex: "none",
      }}
    >
      <strong style={{ letterSpacing: ".02em", whiteSpace: "nowrap" }}>BẢN DỰNG THỬ</strong>
      <span>
        {what} <b>chưa có backend</b>. Mọi con số, danh sách và hình vẽ trên màn
        hình này là <b>dữ liệu mẫu viết cứng</b> — chúng không đến từ bản vẽ của
        bạn và sẽ không đổi theo bản vẽ.
        {real ? ` Thứ duy nhất đọc thật: ${real}.` : ""}{" "}
        Đừng chép số ở đây vào hồ sơ.
      </span>
    </div>
  );
}
