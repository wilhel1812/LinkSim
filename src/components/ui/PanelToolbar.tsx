import clsx from "clsx";
import type { ReactNode } from "react";

type PanelToolbarProps = {
  /** Left-aligned content: section title, endpoint grid, or left-side action button. */
  title?: ReactNode;
  /** Right-aligned icon buttons or controls. */
  actions?: ReactNode;
  className?: string;
};

export function PanelToolbar({ title, actions, className }: PanelToolbarProps) {
  return (
    <div className={clsx("panel-toolbar-row", className)}>
      {title != null ? <div className="panel-toolbar-title">{title}</div> : null}
      {actions != null ? <div className="panel-toolbar-actions">{actions}</div> : null}
    </div>
  );
}
