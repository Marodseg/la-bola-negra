export const $ = (id) => document.getElementById(id);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Crea elementos sin innerHTML (todo el texto entra como texto, nunca como HTML). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

let toastTimer;
export function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}
