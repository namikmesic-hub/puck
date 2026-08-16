/** Small DOM builders and interaction primitives used across the renderer. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Two-stage destructive button: first click arms it ("Confirm?"), second fires. */
export function armDelete(btn: HTMLButtonElement, fn: () => void | Promise<void>): void {
  const label = btn.textContent ?? 'Delete';
  let disarm: ReturnType<typeof setTimeout> | null = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (disarm) {
      clearTimeout(disarm);
      disarm = null;
      void fn();
    } else {
      btn.textContent = 'Confirm?';
      btn.classList.add('armed');
      disarm = setTimeout(() => {
        disarm = null;
        btn.textContent = label;
        btn.classList.remove('armed');
      }, 3000);
    }
  });
}

/** Brief success acknowledgment on a save button. */
export function flashSaved(btn: HTMLButtonElement): void {
  const label = btn.textContent;
  btn.textContent = 'Saved ✓';
  setTimeout(() => {
    btn.textContent = label;
  }, 1600);
}

/** Bottom-corner toast for failures that must not stay invisible. */
export function showToast(message: string): void {
  document.querySelector('.toast')?.remove();
  const toast = el('div', 'toast', message);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

/** Status chip: dot + word, on/off. */
export function statusEl(on: boolean, label: string): HTMLElement {
  const wrap = el('span', 'status' + (on ? ' on' : ''));
  wrap.appendChild(el('span', 'dot'));
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}
