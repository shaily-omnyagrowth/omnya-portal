import { HugeiconsIcon } from "@hugeicons/react";

export default function Icon({ icon, size = 18, strokeWidth = 1.6, label, ...rest }) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...rest}
    />
  );
}
