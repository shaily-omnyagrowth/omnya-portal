import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import Icon from "./Icon";

const ICONS = { error: Alert02Icon, warning: Alert02Icon, success: CheckmarkCircle02Icon, info: InformationCircleIcon };

export default function Alert({ tone = "info", title, children, action, style }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"} style={style}>
      <Icon icon={ICONS[tone] || InformationCircleIcon} size={16} />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}
