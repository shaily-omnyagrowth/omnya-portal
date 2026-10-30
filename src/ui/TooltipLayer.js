import { useEffect, useRef, useState } from "react";

const TARGET = "[data-tip], [title], button[aria-label], a[aria-label], [role='button'][aria-label]";

// Reads the tip text, moving any native title into data-tip so the browser tooltip never shows.
function tipFor(el) {
  if (el.hasAttribute("title")) {
    const t = el.getAttribute("title");
    el.removeAttribute("title");
    if (t) el.dataset.tip = t;
  }
  if (el.dataset.tip) return el.dataset.tip;
  if (el.matches("input, select, textarea, iframe, svg *")) return "";
  return el.textContent.trim() ? "" : el.getAttribute("aria-label") || "";
}

// One tooltip for the whole app: any title, data-tip, or icon-only control with an aria-label.
export default function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const timer = useRef(0);
  const current = useRef(null);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); current.current = null; setTip(null); };
    const showFor = (el, delay) => {
      const text = tipFor(el);
      if (!text) return hide();
      if (current.current === el) return undefined;
      current.current = el;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, r, side: el.dataset.tipSide || "top" });
      }, delay);
      return undefined;
    };
    const onOver = (e) => {
      if (e.pointerType === "touch") return;
      const el = e.target.closest?.(TARGET);
      if (!el) return current.current && hide();
      showFor(el, tip ? 0 : 350);
    };
    const onFocus = (e) => {
      const el = e.target.closest?.(TARGET);
      if (el && e.target.matches(":focus-visible")) showFor(el, 0);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
      clearTimeout(timer.current);
    };
  }, [tip]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try { tip ? el.showPopover() : el.hidePopover(); } catch (_) {}
  }, [tip]);

  let style;
  if (tip) {
    const { r, side } = tip;
    style = side === "right"
      ? { left: r.right + 10, top: r.top + r.height / 2, transform: "translateY(-50%)" }
      : { left: Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80), top: r.top - 8, transform: "translate(-50%, -100%)" };
  }

  return <div ref={ref} popover="manual" role="tooltip" className={`tooltip tooltip-${tip?.side || "top"}`} style={style}>{tip?.text}</div>;
}
