import { useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import Icon from "./Icon";

// Page numbers with gaps, e.g. 1 … 4 5 6 … 12.
export function pageList(page, count) {
  const keep = new Set([0, count - 1, page - 1, page, page + 1].filter(p => p >= 0 && p < count));
  const out = [];
  [...keep].sort((a, b) => a - b).forEach((p, i, all) => {
    if (i && p - all[i - 1] > 1) out.push(p - all[i - 1] === 2 ? p - 1 : null);
    out.push(p);
  });
  return out;
}

export function Pagination({ page, count, total, size, onPage, label = "rows" }) {
  if (count <= 1) return null;
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="pager-info">{from}–{to} of {total.toLocaleString()} {label}</span>
      <div className="pager-pages">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page"><Icon icon={ArrowLeft01Icon} size={16} /></button>
        {pageList(page, count).map((p, i) => p === null
          ? <span key={`gap${i}`} className="pager-gap" aria-hidden="true">…</span>
          : <button type="button" key={p} className="pager-num" aria-current={p === page ? "page" : undefined} aria-label={`Page ${p + 1}`} onClick={() => onPage(p)}>{p + 1}</button>)}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onPage(page + 1)} disabled={page >= count - 1} aria-label="Next page"><Icon icon={ArrowRight01Icon} size={16} /></button>
      </div>
    </nav>
  );
}

// Slices items into pages; a new result count (search, filter) goes back to page one.
export default function usePagination(items, { size = 25, label } = {}) {
  const list = items || [];
  const [state, setState] = useState({ page: 0, total: list.length });
  const current = state.total === list.length ? state.page : 0;
  if (state.total !== list.length) setState({ page: 0, total: list.length });
  const count = Math.ceil(list.length / size);
  const page = Math.min(current, Math.max(0, count - 1));
  const onPage = p => setState({ page: Math.max(0, Math.min(p, count - 1)), total: list.length });
  return {
    rows: list.slice(page * size, page * size + size),
    offset: page * size,
    pager: <Pagination page={page} count={count} total={list.length} size={size} onPage={onPage} label={label} />,
  };
}
