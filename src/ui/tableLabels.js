// Copies each column header onto its cells as data-label so tables can stack into cards on phones.
function label(table) {
  const heads = [...table.querySelectorAll("thead th")].map(th => (th.querySelector(".sr-only") && th.children.length === 1 ? "" : th.textContent.trim()));
  if (!heads.length) return;
  table.querySelectorAll("tbody tr").forEach(tr => {
    [...tr.children].forEach((td, i) => {
      const text = td.getAttribute("colspan") ? "" : heads[i] || "";
      if (td.dataset.label !== text) td.dataset.label = text;
    });
  });
}

export default function watchTables(root = document.body) {
  let queued = false;
  const run = () => { queued = false; root.querySelectorAll(".table-wrap table").forEach(label); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  mo.observe(root, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
