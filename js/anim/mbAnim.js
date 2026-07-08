// mbAnim.js — base class for animated worked-example Web Components.
// Mirrors the mech.js demo idiom: a normalized timer t ∈ [0,1] drives every frame.
// Subclasses implement renderFrame(t) and steps ([{at, label}] captions).
// Attributes: params (JSON), duration (seconds, default 8).

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class MbAnim extends HTMLElement {
  connectedCallback() {
    this.params = JSON.parse(this.getAttribute('params') || '{}');
    this.duration = Number(this.getAttribute('duration')) || 8;
    this.t = 0;
    this._raf = 0;
    this._last = 0;

    this.classList.add('mb-anim');
    this.svg = svgEl('svg', { viewBox: this.viewBox, class: 'mb-anim-svg' });
    const controls = document.createElement('div');
    controls.className = 'mb-anim-controls';
    this._btn = document.createElement('button');
    this._btn.type = 'button';
    this._btn.textContent = '▶';
    this._btn.addEventListener('click', () => (this._raf ? this.pause() : this.play()));
    this._range = document.createElement('input');
    this._range.type = 'range';
    this._range.min = 0; this._range.max = 1000; this._range.value = 0;
    this._range.addEventListener('input', () => { this.pause(); this.seek(this._range.valueAsNumber / 1000); });
    controls.append(this._btn, this._range);
    this._caption = document.createElement('div');
    this._caption.className = 'mb-anim-caption';
    this.replaceChildren(this.svg, controls, this._caption);
    this.renderFrame(0);
    this._syncUI();
  }

  disconnectedCallback() { this.pause(); }

  get viewBox() { return '0 0 640 360'; }
  get steps() { return []; }
  renderFrame(_t) {}

  play() {
    if (this.t >= 1) this.t = 0;
    this._last = performance.now();
    const tick = (now) => {
      this.t = Math.min(1, this.t + (now - this._last) / 1000 / this.duration);
      this._last = now;
      this.renderFrame(this.t);
      this._syncUI();
      if (this.t < 1) this._raf = requestAnimationFrame(tick);
      else { this._raf = 0; this._btn.textContent = '▶'; }
    };
    this._raf = requestAnimationFrame(tick);
    this._btn.textContent = '⏸';
  }

  pause() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._btn) this._btn.textContent = '▶';
  }

  seek(t) {
    this.t = Math.min(1, Math.max(0, t));
    this.renderFrame(this.t);
    this._syncUI();
  }

  _syncUI() {
    this._range.value = Math.round(this.t * 1000);
    let label = '';
    for (const s of this.steps) if (this.t >= s.at) label = s.label;
    this._caption.textContent = label;
  }
}
