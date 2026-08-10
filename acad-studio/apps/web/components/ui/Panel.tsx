/** Khối nội dung có tiêu đề — đơn vị bố cục chính của mọi màn hình. */
import type { ReactNode } from "react";

export function Panel({ title, actions, children, id }: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" aria-label={title} data-od-id={id}>
      <header>
        <h2>{title}</h2>
        {actions ? <div className="actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
