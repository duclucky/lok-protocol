import { FlaskConical } from "lucide-react";
import type { PropsWithChildren } from "react";

export function DemoControl({ children }: PropsWithChildren) {
  return (
    <section className="demo-control" role="region" aria-label="Demo control">
      <div className="demo-control__label">
        <FlaskConical aria-hidden="true" size={16} />
        Demo control
      </div>
      {children}
    </section>
  );
}
