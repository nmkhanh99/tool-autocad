"use client";

/** Nút GHI vào bản vẽ. Chỗ duy nhất khoá được lệnh ghi một cách thật sự.
 *
 * Bộ mẫu khoá bằng đúng một quy tắc CSS:
 *
 *     body[data-acad="busy"] [data-write] { opacity:.4; pointer-events:none }
 *
 * `pointer-events: none` **không** gỡ nút khỏi thứ tự Tab và **không** chặn
 * Enter hay Space. Với sản phẩm mà mọi lệnh ghi đều không hoàn tác được, "nút
 * trông như bị khoá nhưng vẫn bấm được bằng bàn phím" là lỗ hổng thật.
 *
 * Nằm ở `components/ui/` chứ không ở `features/`: mọi màn hình đều cần nút này,
 * và một primitive không được phụ thuộc vào một feature cụ thể.
 *
 * Trạng thái đọc từ **context**, không nhận qua prop: nếu nơi gọi phải tự
 * truyền `acadState`, sớm muộn sẽ có chỗ truyền nhầm hoặc quên. Không có
 * provider thì mặc định là `off` — fail-closed.
 */
import { createContext, useContext, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { canWrite, type AcadState } from "../../lib/acadState";

const AcadStateContext = createContext<AcadState>("off");

export function AcadStateProvider({ state, children }: { state: AcadState; children: ReactNode }) {
  return <AcadStateContext.Provider value={state}>{children}</AcadStateContext.Provider>;
}

export function useAcadStateValue(): AcadState {
  return useContext(AcadStateContext);
}

/** Nói rõ vì sao không bấm được, ngay trên nút. Một nút mờ đi mà không giải
 * thích buộc người dùng phải đoán. */
export function acadBlockReason(state: AcadState): string {
  switch (state) {
    /* KHÔNG "AutoCAD đang bận": app chỉ biết đã gửi lệnh và chưa nhận kết quả.
       Lệnh đang chạy thật và lệnh đã hỏng giữa chừng cho ra cùng trạng thái, và
       ở ca thứ hai thì AutoCAD đang rảnh. Câu chữ phải khớp pill ở thanh trên —
       hai chỗ nói hai nguyên nhân khác nhau về cùng một trạng thái thì người
       dùng tin chỗ nào cũng sai một nửa.
       Và KHÔNG hứa "tự hết sau ít phút" ở đây: trạng thái chờ cũng bật khi có
       job xếp hàng, mà lúc đó không có hạn nào đúng — khoá kéo dài tới khi hàng
       đợi cạn. Bịa một cái hạn ở đúng ca không biết hạn là lỗi mà `busyText()`
       sinh ra để tránh; nói lại nó ở đây là dựng lại lỗi đó bằng chuỗi cứng.
       Chỗ CÓ mốc thật thì đọc `busyUntil` qua `busyText()`. */
    case "busy": return "Đang chờ AutoCAD trả kết quả cho lệnh trước";
    case "off": return "AutoCAD chưa chạy — mở AutoCAD rồi thử lại";
    case "missing": return "Chưa cài AutoCAD trên máy này";
    case "no-plugin": return "Chưa nạp plugin AcadBridge — gõ APPLOAD trong AutoCAD";
    case "mute": return "Plugin không phản hồi — khởi động lại AutoCAD";
    default: return "Chưa đủ điều kiện ghi vào bản vẽ";
  }
}

export function WriteButton({ disabled, title, ...rest }: ButtonProps) {
  const state = useAcadStateValue();
  const blocked = !canWrite(state);
  return (
    <Button
      {...rest}
      // `data-write` chỉ để CSS của mẫu tạo kiểu — nó KHÔNG phải cơ chế an toàn.
      data-write=""
      disabled={Boolean(disabled) || blocked}
      aria-disabled={Boolean(disabled) || blocked || undefined}
      title={blocked ? acadBlockReason(state) : title}
    />
  );
}
