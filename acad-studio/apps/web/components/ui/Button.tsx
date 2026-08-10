"use client";

/** Nút — primitive thuần, không biết gì về AutoCAD.
 *
 * Nút GHI vào bản vẽ không dùng trực tiếp component này mà dùng
 * `features/acad-connection/WriteButton`: khoá lệnh ghi là tri thức nghiệp vụ,
 * và một primitive dùng chung không được kéo theo cả tầng kết nối.
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
