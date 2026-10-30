import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import Icon from "./Icon";

const ICONS = { error: Alert02Icon, warning: Alert02Icon, success: CheckmarkCircle02Icon, info: InformationCircleIcon };

export default function Alert({ tone = "info", title, children, action, style }) {
  const head = title || children;
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"} style={style}>
      <div className="alert-head">
        <Icon icon={ICONS[tone] || InformationCircleIcon} size={16} />
        <div className={title ? "alert-title" : "alert-msg"}>{head}</div>
        {action && <div className="alert-action">{action}</div>}
      </div>
      {title && children && <div className="alert-text">{children}</div>}
    </div>
  );
}
