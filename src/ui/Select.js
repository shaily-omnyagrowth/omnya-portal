import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import Icon from "./Icon";

const textOf = (node) => Children.toArray(node).map(n => (typeof n === "string" || typeof n === "number" ? String(n) : isValidElement(n) ? textOf(n.props.children) : "")).join("");

function readOptions(children) {
  const out = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === "option") {
      const label = textOf(c.props.children);
      out.push({ value: String(c.props.value ?? label), label, disabled: !!c.props.disabled });
    } else if (c.props?.children) out.push(...readOptions(c.props.children));
  });
  return out;
}

// Drop-in for <select>: same <option> children, onChange gets { target: { value } }.
export default function Select({ id, name, value, onChange, disabled, children, className = "", style, placeholder = "Select", ...aria }) {
  const options = readOptions(children);
  const current = String(value ?? "");
  const selected = options.find(o => o.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    setPos({ left: r.left, minWidth: r.width, maxWidth: Math.max(r.width, Math.min(360, window.innerWidth - r.left - 16)), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), maxHeight: Math.max(160, Math.min(320, (up ? r.top : below) - 16)) });
  };

  const show = () => {
    if (disabled) return;
    place();
    setActive(Math.max(0, options.findIndex(o => o.value === current)));
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) triggerRef.current?.focus(); };
  const pick = (o) => {
    if (!o || o.disabled) return;
    if (o.value !== current) onChange?.({ target: { value: o.value, name } });
    close();
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (open) { try { el.showPopover(); } catch (_) {} } else { try { el.hidePopover(); } catch (_) {} }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!listRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) close(false); };
    const onMove = (e) => { if (!listRef.current?.contains(e.target)) place(); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onMove, true);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("resize", place); window.removeEventListener("scroll", onMove, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const step = (dir) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open ? step(e.key === "ArrowDown" ? 1 : -1) : show(); }
    else if (e.key === "Home" && open) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && open) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open ? pick(options[active]) : show(); }
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab" && open) close(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 600 ? "" : typed.current.text) + e.key.toLowerCase(), at: now };
      const i = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) open ? setActive(i) : pick(options[i]);
    }
  };

  return (
    <>
      <button
        ref={triggerRef} id={id} type="button" disabled={disabled}
        className={`select select-trigger ${className.replace(/\bselect\b/, "")}`} style={style}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? close() : show())} onKeyDown={onKeyDown} {...aria}
      >
        <span className={`truncate ${selected ? "" : "text-muted"}`}>{selected?.label || placeholder}</span>
        <Icon icon={ArrowDown01Icon} size={14} className="select-caret" />
      </button>
      <ul ref={listRef} id={listId} role="listbox" popover="manual" className="select-list" style={pos || undefined} aria-labelledby={id}>
        {open && options.map((o, i) => (
          <li key={o.value + i} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={o.value === current} aria-disabled={o.disabled || undefined}
            className={`select-option ${i === active ? "active" : ""}`}
            onPointerMove={() => !o.disabled && active !== i && setActive(i)} onClick={() => pick(o)}>
            <span className="truncate">{o.label}</span>
            {o.value === current && <Icon icon={Tick02Icon} size={14} />}
          </li>
        ))}
      </ul>
    </>
  );
}
