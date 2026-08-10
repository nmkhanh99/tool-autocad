"use client";

/** Nút — primitive thuần, không biết gì về AutoCAD.
 *
 * Nút GHI vào bản vẽ không dùng trực tiếp component này mà dùng `WriteButton`
 * bên cạnh: khoá lệnh ghi cần trạng thái kết nối AutoCAD, và tách ra giữ cho
 * nút thường không kéo theo context nào.
 */
import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "quiet";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Nút chỉ có biểu tượng — nhớ kèm `title` hoặc `aria-label`. */
  icon?: boolean;
};

const VARIANT: Record<Variant, string> = {
  default: "btn",
  primary: "btn btn--primary",
  quiet: "btn btn--quiet",
};

export function Button({ variant = "default", icon = false, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={[VARIANT[variant], icon ? "btn--icon" : "", className].filter(Boolean).join(" ")}
    />
  );
}
