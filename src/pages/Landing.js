import React, { useEffect, useRef } from "react";
import LANDING_CSS from "./landing/styles";
import LANDING_HTML from "./landing/markup";

// Public marketing page served at "/" to signed-out visitors. The markup is our
// own static HTML, so it is injected as-is; the CSS lives in a <style> element
// owned by this component so its global rules (body, h1, .btn) leave with it
// and never leak into the portal.

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Outfit:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap";
const CONTACT_EMAIL = "admin@omnyagrowth.com";
const TITLE = "Omnya Growth — creator marketing that builds audiences instead of renting them";

const FORM_SUBJECTS = {
  roster: "Roster application",
  inquiry: "New inquiry",
};

// Use-case panel: hovering or focusing a list item swaps the caption and
// redraws the contour canvas (or shows its data-img still, when one is set).
function mountUseCasePanel(root) {
  const list = root.querySelector("#objList");
  const cv = root.querySelector("#ucCanvas");
  if (!list || !cv) return () => {};
  const im = root.querySelector("#ucImg");
  const cap = root.querySelector("#ucCap");
  const tag = root.querySelector("#ucTag");
  const x = cv.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, seed = 0;
  const items = Array.from(list.querySelectorAll("li"));

  function draw() {
    x.clearRect(0, 0, W, H);
    x.fillStyle = "#131418"; x.fillRect(0, 0, W, H);
    const cx = W * 0.5, cy = H * 0.46, base = Math.min(W, H) * 0.34, k = seed;
    for (let L = 0; L < 30; L++) {
      const f = L / 29, r = base * (0.5 + f * 0.72), ph = k * 0.8 + L * 0.17;
      x.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 90) {
        const w = Math.sin(a * (2 + k % 4) + ph) * 0.07 + Math.sin(a * (5 + k % 3) - ph * 1.4) * 0.035 + Math.sin(a * 3 + ph * 0.5) * 0.05;
        const rr = r * (1 + w), px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.98;
        if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath();
      const g = x.createLinearGradient(cx - base, cy - base, cx + base, cy + base), sh = Math.sin(ph) * 0.5 + 0.5;
      g.addColorStop(0, "rgba(120,126,134," + (0.16 + sh * 0.18) + ")");
      g.addColorStop(0.35, "rgba(246,247,249," + (0.30 + sh * 0.34) + ")");
      g.addColorStop(0.6, "rgba(150,155,162," + (0.20 + sh * 0.20) + ")");
      g.addColorStop(1, "rgba(60,64,70," + (0.14 + sh * 0.16) + ")");
      x.strokeStyle = g; x.lineWidth = L % 6 === 0 ? 1.5 : 0.75; x.stroke();
    }
  }
  function size() {
    const r = cv.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = W * dpr; cv.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function select(li, i) {
    items.forEach((n) => n.classList.remove("on"));
    li.classList.add("on");
    cap.textContent = li.getAttribute("data-cap");
    tag.textContent = li.getAttribute("data-tag");
    const src = li.getAttribute("data-img");
    if (src) { im.src = src; im.hidden = false; cv.style.display = "none"; }
    else { im.hidden = true; cv.style.display = "block"; seed = i + 1; draw(); }
  }

  const unbind = items.map((li, i) => {
    const on = () => select(li, i);
    li.tabIndex = 0;
    li.addEventListener("mouseenter", on);
    li.addEventListener("focus", on);
    return () => { li.removeEventListener("mouseenter", on); li.removeEventListener("focus", on); };
  });
  window.addEventListener("resize", size);
  size();
  if (items[0]) select(items[0], 0);
  return () => { unbind.forEach((u) => u()); window.removeEventListener("resize", size); };
}

// The forms were built for Netlify Forms, which do nothing on Vercel, and the
// CSP blocks posting anywhere else. Until there is an /api endpoint for leads,
// hand the visitor a pre-filled email so a submission is never silently lost.
function mountForms(root) {
  const forms = Array.from(root.querySelectorAll("form.form"));
  const onSubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const trap = form.getAttribute("data-honeypot");
    const data = new FormData(form);
    if (trap && data.get(trap)) return;
    const lines = [];
    for (const [key, value] of data.entries()) {
      if (key === trap || !String(value).trim()) continue;
      const label = form.querySelector(`label[for="${form.querySelector(`[name="${key}"]`)?.id}"]`)?.textContent || key;
      lines.push(`${label}: ${value}`);
    }
    const subject = FORM_SUBJECTS[form.getAttribute("name")] || "Website enquiry";
    window.location.href =
      `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
    let note = form.querySelector(".formnote[data-sent]");
    if (!note) {
      note = document.createElement("p");
      note.className = "formnote";
      note.setAttribute("data-sent", "");
      note.setAttribute("role", "status");
      form.appendChild(note);
    }
    note.textContent = `Your email app should open with this message ready to send. If it does not, write to ${CONTACT_EMAIL}.`;
  };
  forms.forEach((f) => f.addEventListener("submit", onSubmit));
  return () => forms.forEach((f) => f.removeEventListener("submit", onSubmit));
}

export default function Landing() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const prevTitle = document.title;
    document.title = TITLE;
    const unmountPanel = mountUseCasePanel(root);
    const unmountForms = mountForms(root);
    return () => {
      document.title = prevTitle;
      unmountPanel();
      unmountForms();
    };
  }, []);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{LANDING_CSS}</style>
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
    </>
  );
}
