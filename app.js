// Plain script (not a module) so index.html also works when opened directly via file://.
(function () {
  const PROJECTS_KEY = "counter:projects";
  const CURRENT_KEY = "counter:current-project";
  const DEFAULT_NAME = "New project";
  const DEFAULT_DOT = "#5c5348"; // dot colour until one is picked
  const VISIBLE_ROWS = 3;

  const countEl = document.getElementById("count");
  const dotsEl = document.getElementById("dots");
  const scrollerEl = document.getElementById("dot-scroller"); // horizontal scroller inside the dots strip
  const rowsEl = document.getElementById("dot-rows");
  const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  let count = 0; // set from the project's last row when it is opened (see openProject)

  // Projects: { id, name, updatedAt, entries, colors, color? }. The current project's `entries` array is the dots
  // pile (one count per row); `colors` runs alongside it (each row's dot colour, fixed when the row is entered — a
  // hex string, or an array with one hex per square once part of the row has been recoloured through a selection);
  // `color` is the colour for new rows. Every change is saved automatically.
  const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

  // A row's colours, one per square (from either form of `colors[i]`).
  const squareColors = (color, n) => (Array.isArray(color) ? color.slice() : Array(n).fill(color));

  // Back to the compact form: one string when every square has the same colour.
  const packColors = (list) => (list.every((c) => c === list[0]) ? list[0] : list);

  let projects = loadProjects();
  let current = projects.find((p) => p.id === localStorage.getItem(CURRENT_KEY)) || projects[0];
  let entries = current.entries;
  persistProjects();
  // Pre-projects storage, migrated by loadProjects(), and the old shared count (no longer stored).
  for (const key of ["counter:entries", "counter:designs", "counter:pile-dirty", "counter:value"]) localStorage.removeItem(key);

  function loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function isCount(n) {
    return Number.isInteger(n) && n > 0;
  }

  function makeProject(rows = [], name = DEFAULT_NAME, time = Date.now()) {
    return { id: time.toString(36) + Math.random().toString(36).slice(2, 6), name, updatedAt: time, entries: rows,
      colors: rows.map(() => DEFAULT_DOT) };
  }

  // Drop invalid rows (keeping each row's colour with it); rows saved before per-row colours existed get the colour
  // they were showing — the project's colour at the time. Per-square colours must match the row's length.
  function cleanProject(p) {
    const fallback = isHex(p.color) ? p.color : DEFAULT_DOT;
    const rows = p.entries.map((n, i) => [n, Array.isArray(p.colors) ? p.colors[i] : null]).filter(([n]) => isCount(n));
    const color = (c, n) =>
      isHex(c) ? c : Array.isArray(c) && c.length === n && c.every(isHex) ? packColors(c) : fallback;
    return { ...p, entries: rows.map(([n]) => n), colors: rows.map(([n, c]) => color(c, n)) };
  }

  function loadProjects() {
    const saved = loadJSON(PROJECTS_KEY, null);
    let list;
    if (Array.isArray(saved)) {
      list = saved.filter((p) => p && Array.isArray(p.entries)).map(cleanProject);
    } else {
      // First run: migrate the old single pile (counter:entries) and saved designs (counter:designs).
      const pile = loadJSON("counter:entries", []);
      const designs = loadJSON("counter:designs", []);
      list = [
        makeProject(Array.isArray(pile) ? pile.filter(isCount) : []),
        ...(Array.isArray(designs) ? designs : [])
          .filter((d) => d && Array.isArray(d.entries))
          .map((d) => makeProject(d.entries.filter(isCount), dateFormat.format(d.savedAt), d.savedAt)),
      ];
    }
    return list.length ? list : [makeProject()];
  }

  function persistProjects() {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    localStorage.setItem(CURRENT_KEY, current.id);
  }

  // Called after every change to the pile (enter, delete row).
  function saveEntries() {
    current.updatedAt = Date.now();
    persistProjects();
  }

  function render() {
    countEl.textContent = count;
  }

  // One row of dots per entry, newest on top (the strip sits on the bottom edge). The strip's height (CSS) fits
  // VISIBLE_ROWS rows and is kept scrolled to the top; older rows are reachable by scrolling down.
  // `animateLast` pops in the newest row.
  // `keepScroll` preserves the current vertical/horizontal scroll (used after deleting a row).
  function renderDots(animateLast, keepScroll) {
    const top = dotsEl.scrollTop, left = scrollerEl.scrollLeft;
    const newestFirst = entries.slice().reverse();
    rowsEl.replaceChildren(
      ...newestFirst.map((n, rowIndex) => {
        const index = entries.length - 1 - rowIndex; // position in `entries`
        const row = buildRow(n, current.colors[index]); // the colour(s) it was entered with, or recoloured to
        if (animateLast && rowIndex === 0) row.classList.add("row--new");
        row.dataset.index = index;
        // Group marker on the bottom row of each run of equal rows: a line beside the run and "squares x rows".
        if (n !== newestFirst[rowIndex + 1]) {
          let k = 1;
          while (newestFirst[rowIndex - k] === n) k++;
          const mark = groupMark(n, k);
          // The closed strip shows only the first VISIBLE_ROWS rows: if this run starts in view but ends below it,
          // its label is lifted to the last row in view (CSS applies --lift only outside history mode).
          const start = rowIndex - k + 1;
          if (start < VISIBLE_ROWS && rowIndex >= VISIBLE_ROWS) mark.style.setProperty("--lift", rowIndex - VISIBLE_ROWS + 1);
          row.appendChild(mark);
        }
        return row;
      })
    );
    renderTags();
    const recent = entries.slice(-VISIBLE_ROWS);
    dotsEl.setAttribute("aria-label", recent.length ? `Recent entries: ${recent.join(", ")}` : "No entries yet");
    dotsEl.classList.toggle("has-more", entries.length > VISIBLE_ROWS);
    if (keepScroll) {
      dotsEl.scrollTop = top;
      scrollerEl.scrollLeft = left;
    } else {
      scrollDotsToLatest();
      // Rows wider than the screen overflow both edges; start centered.
      centerDots(false);
    }
    updateTags();
  }

  // Goalpost tags: a group's marker (line + "13x4") hangs off its rows, so on long rows — the strip stays centred — it
  // can be off the screen. Then a tag pinned to that screen edge shows its label, pointed toward the marker; tapping
  // it glides the strip over to the marker (double-tap the dots to re-centre), and once the marker is in view the tag
  // goes away. Tags live in #dot-tags, outside the sideways scroller: they scroll up/down with the rows but stay on
  // the screen's edge. Not on the Home previews.
  const tagsEl = document.getElementById("dot-tags");
  const TAG_EDGE = 8; // a marker closer than this to a screen edge counts as out of view
  let tags = []; // { mark, el } per group marker

  function renderTags() {
    tags = [...rowsEl.querySelectorAll(".row__mark")].map((mark) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "dot-tag";
      el.textContent = mark.textContent;
      el.setAttribute("aria-label", `Show ${mark.textContent}`);
      el.style.setProperty("--y", `${mark.parentElement.offsetTop}px`); // level with the row's top (not above the strip)
      const lift = mark.style.getPropertyValue("--lift");
      if (lift) el.style.setProperty("--lift", lift);
      return { mark, el };
    });
    tagsEl.replaceChildren(...tags.map((t) => t.el));
  }

  // Show a tag while its marker is off screen: its label past the right edge, or its line past the left one.
  function updateTags() {
    for (const { mark, el } of tags) {
      const line = mark.getBoundingClientRect(), label = mark.firstChild.getBoundingClientRect();
      const side = label.right > window.innerWidth - TAG_EDGE ? "right" : line.left < TAG_EDGE ? "left" : "";
      el.classList.toggle("is-shown", side !== "");
      if (side) el.classList.toggle("dot-tag--left", side === "left"); // fading out, it keeps its side
      el.dataset.side = side;
    }
  }

  let tagsFrame = 0;
  const scheduleTags = () => {
    if (!tagsFrame) tagsFrame = requestAnimationFrame(() => {
      tagsFrame = 0;
      updateTags();
    });
  };
  scrollerEl.addEventListener("scroll", scheduleTags, { passive: true });
  window.addEventListener("resize", scheduleTags);

  // Tap a tag: glide sideways until its marker is in view, 16px from the edge.
  tagsEl.addEventListener("click", (e) => {
    const tag = tags.find((t) => t.el === e.target.closest(".dot-tag"));
    if (!tag?.el.dataset.side) return;
    const line = tag.mark.getBoundingClientRect(), label = tag.mark.firstChild.getBoundingClientRect();
    const by = tag.el.dataset.side === "left" ? line.left - 16 : label.right - (window.innerWidth - 16);
    scrollerEl.scrollBy({ left: by, behavior: "smooth" });
  });
  // A tap on a tag is not a tap, long-press or drag on the dots.
  for (const type of ["pointerdown", "pointerup", "touchstart"]) tagsEl.addEventListener(type, (e) => e.stopPropagation());

  // Group marker: a thin line to the right of a run of k equal rows (top of its first row to bottom of its last),
  // with "n x k" beside its bottom — or just "n" for a single row. Positioned by CSS from the run's bottom row.
  function groupMark(n, k) {
    const mark = document.createElement("span");
    mark.className = "row__mark";
    mark.style.setProperty("--k", k);
    mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "row__count";
    label.textContent = k > 1 ? `${n}x${k}` : `${n}`;
    mark.appendChild(label);
    return mark;
  }

  // One row of n dots in `color`: a hex for the whole row, or one per square.
  function buildRow(n, color) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.setProperty("--n", n);
    if (!Array.isArray(color)) row.style.setProperty("--dot", color);
    for (let i = 0; i < n; i++) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.setProperty("--i", i);
      if (Array.isArray(color)) dot.style.setProperty("--dot", color[i]);
      row.appendChild(dot);
    }
    return row;
  }

  // Scroll the dots horizontally so the group is centered on the screen's vertical axis. Only the squares count: the
  // group markers are extra (they hang off the rows and #dot-rows' side padding is symmetric).
  function centerDots(smooth) {
    scrollerEl.scrollTo({ left: (scrollerEl.scrollWidth - scrollerEl.clientWidth) / 2, behavior: smooth ? "smooth" : "auto" });
  }

  function scrollDotsToLatest() {
    dotsEl.scrollTop = 0;
  }

  // History mode. Dragging up on the dots strip (anchored to the bottom edge) grows it 1:1 with the finger
  // while keeping it scrolled to the newest rows, so they stay under the finger and older rows are revealed
  // below. On release it either settles open (history mode: natively scrollable, count dimmed + blurred,
  // close × button) or springs back.
  const OPEN_THRESHOLD = 48; // px of pull needed to settle open
  const FLICK_VELOCITY = 0.5; // px/ms flick that opens/closes regardless of distance
  const RUBBER = 0.35; // resistance when pulling past the available height
  const AXIS_SLOP = 4; // px of movement before deciding whether a gesture is vertical (ours) or horizontal (native scroll)
  const ANIM_MS = 280; // keep in sync with .dots.is-animating in styles.css

  const isHistory = () => document.body.classList.contains("is-history");
  let drag = null;
  let animFrame = 0;
  let animTimer = 0;

  // The strip's default (CSS) height, measured without the inline height set during drags.
  function closedHeight() {
    const { height, maxHeight } = dotsEl.style;
    dotsEl.style.height = dotsEl.style.maxHeight = "";
    const h = dotsEl.getBoundingClientRect().height;
    Object.assign(dotsEl.style, { height, maxHeight });
    return h;
  }

  // Fully open: tall enough for every row, but stopping 16px below the close × bar.
  function openHeight() {
    const bar = document.querySelector(".bar--history");
    const content = scrollerEl.offsetHeight + parseFloat(getComputedStyle(dotsEl).paddingBottom);
    return Math.min(content, dotsEl.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom - 16);
  }

  function setPull(p) {
    document.body.style.setProperty("--pull", Math.min(1, Math.max(0, p)));
  }

  function setHeight(h, overshoot) {
    dotsEl.style.maxHeight = "none";
    dotsEl.style.height = `${h}px`;
    dotsEl.style.transform = overshoot ? `translateY(${-overshoot}px)` : "";
    scrollDotsToLatest();
  }

  function stopAnimation() {
    cancelAnimationFrame(animFrame);
    clearTimeout(animTimer);
    dotsEl.classList.remove("is-animating");
  }

  // CSS transitions the height; each frame re-pins the scroll to the newest rows so they move with the edge.
  function animateTo(h, onDone) {
    stopAnimation();
    dotsEl.classList.add("is-animating");
    setHeight(h, 0);
    const pin = () => {
      scrollDotsToLatest();
      animFrame = requestAnimationFrame(pin);
    };
    pin();
    animTimer = setTimeout(() => {
      stopAnimation();
      if (onDone) onDone();
    }, ANIM_MS + 20);
  }

  function openHistory() {
    document.body.classList.add("is-history");
    setPull(1);
    animateTo(openHeight());
  }

  function closeHistory() {
    document.body.classList.remove("is-history");
    setPull(0);
    animateTo(closedHeight(), () => {
      dotsEl.style.height = dotsEl.style.maxHeight = "";
      scrollDotsToLatest();
    });
  }

  dotsEl.addEventListener("pointerdown", (e) => {
    if (isHistory() || isSelecting() || entries.length === 0) return;
    stopAnimation();
    const closed = closedHeight();
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, vertical: false, closed, max: openHeight(),
      h: closed, lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
  });

  dotsEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.vertical) {
      // Horizontal swipes are left to native scrolling (touch-action: pan-x); only vertical ones drive the drag.
      const dx = Math.abs(e.clientX - drag.startX), dy = Math.abs(e.clientY - drag.startY);
      if (Math.max(dx, dy) < AXIS_SLOP) return;
      if (dx > dy) {
        drag = null;
        return;
      }
      drag.vertical = true;
      dotsEl.setPointerCapture(e.pointerId);
      document.body.classList.add("is-dragging");
    }
    drag.pull = Math.max(0, drag.startY - e.clientY);
    const pulled = drag.closed + drag.pull;
    drag.h = Math.min(pulled, drag.max);
    setHeight(drag.h, Math.max(0, pulled - drag.max) * RUBBER);
    // With few rows the strip can't grow (max == closed); dim/blur by pull distance instead.
    setPull(drag.max > drag.closed ? (drag.h - drag.closed) / (drag.max - drag.closed) : drag.pull / 120);
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { vertical, pull = 0, velocity } = drag;
    drag = null;
    if (!vertical) return;
    document.body.classList.remove("is-dragging");
    // velocity < 0 = finger moving up (opening direction)
    const open = (pull > OPEN_THRESHOLD || velocity < -FLICK_VELOCITY) && velocity < FLICK_VELOCITY;
    if (open) openHistory();
    else closeHistory();
  }

  dotsEl.addEventListener("pointerup", endDrag);
  dotsEl.addEventListener("pointercancel", endDrag);

  const isAtLatest = () => dotsEl.scrollTop <= 2;

  // In history mode, pushing the dots back down while the newest rows are showing shrinks the strip 1:1 with the
  // finger (the reverse of the open drag); released past the threshold, or flicked down, it closes. Uses touch
  // events rather than pointer events so native scrolling through older rows keeps working otherwise.
  let shrink = null;

  dotsEl.addEventListener("touchstart", (e) => {
    if (isHistory() && !isSelecting() && e.touches.length === 1) {
      shrink = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, active: false };
    }
  }, { passive: true });

  dotsEl.addEventListener("touchmove", (e) => {
    if (!shrink) return;
    const y = e.touches[0].clientY;
    if (!shrink.active) {
      // Take over only when pushing down from the newest rows; sideways swipes and scrolling through older rows
      // stay native.
      const dx = Math.abs(e.touches[0].clientX - shrink.startX);
      if (Math.max(dx, Math.abs(y - shrink.startY)) < AXIS_SLOP) return;
      if (!isAtLatest() || y < shrink.startY || dx > Math.abs(y - shrink.startY)) {
        shrink = null;
        return;
      }
      stopAnimation();
      Object.assign(shrink, { active: true, open: dotsEl.getBoundingClientRect().height, closed: closedHeight(),
        lastY: y, lastT: e.timeStamp, velocity: 0 });
      shrink.h = shrink.open;
      document.body.classList.add("is-dragging");
    }
    e.preventDefault();
    shrink.h = Math.max(shrink.closed, shrink.open - Math.max(0, y - shrink.startY));
    setHeight(shrink.h, 0);
    setPull((shrink.h - shrink.closed) / (shrink.open - shrink.closed));
    const dt = e.timeStamp - shrink.lastT;
    if (dt > 0) shrink.velocity = (y - shrink.lastY) / dt;
    shrink.lastY = y;
    shrink.lastT = e.timeStamp;
  }, { passive: false });

  function endShrink() {
    if (!shrink) return;
    const { active, open, h, velocity } = shrink;
    shrink = null;
    if (!active) return;
    document.body.classList.remove("is-dragging");
    const close = (open - h > OPEN_THRESHOLD || velocity > FLICK_VELOCITY) && velocity > -FLICK_VELOCITY;
    if (close) closeHistory();
    else openHistory();
  }

  dotsEl.addEventListener("touchend", endShrink);
  dotsEl.addEventListener("touchcancel", endShrink);

  // Mouse wheel / trackpad: scrolling down on the strip opens history; in history, scrolling up past the
  // newest rows closes it.
  dotsEl.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal: native sideways scroll
    if (isHistory()) {
      if (e.deltaY < 0 && isAtLatest()) {
        e.preventDefault();
        closeHistory();
      }
      return;
    }
    e.preventDefault();
    if (e.deltaY > 0 && entries.length > 0) openHistory();
  }, { passive: false });

  document.getElementById("done").addEventListener("click", () => (isSelecting() ? clearSelection() : closeHistory()));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isPicking()) closePicker();
    else if (isHome()) isMenuOpen() ? closeMenu() : clearBallSelection();
    else if (isSelecting()) clearSelection();
    else if (isHistory()) closeHistory();
  });

  // Feedback on counting taps: a mechanical-keyboard click (−1 a little deeper than +1) and a light haptic tick.
  // Sound is synthesized with Web Audio (no files) and set to the "ambient" audio session, so iOS mutes it when the
  // phone is on silent. Haptics: navigator.vibrate where it exists (Android); Safari on iPhone has no vibration API,
  // but toggling a hidden <input type="checkbox" switch> plays the system haptic tick (iOS 18+). That's an
  // unofficial workaround — it only works inside a user gesture, and does nothing (harmlessly) elsewhere.
  let audio = null;
  let noise = null;
  let hapticSwitch = null;

  // A short burst of filtered noise: `type`/`freq`/`q` shape it, `peak` is its loudness, `decay` how fast it dies.
  function burst(out, at, { type, freq, q = 1, peak, decay }) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noise;
    src.loop = true; // the buffer is short; longer bursts just loop it
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(filter).connect(gain).connect(out);
    src.start(at);
    src.stop(at + decay + 0.01);
  }

  // The audio context is created on first use (inside a tap, as mobile browsers require). Returns false if there's
  // no Web Audio.
  function ensureAudio() {
    if (!audio) {
      if (navigator.audioSession) navigator.audioSession.type = "ambient";
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      audio = new AudioCtx();
      noise = audio.createBuffer(1, Math.round(audio.sampleRate * 0.05), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === "suspended") audio.resume();
    return true;
  }

  // A master volume for one sound.
  function output(volume) {
    const out = audio.createGain();
    out.gain.value = volume;
    out.connect(audio.destination);
    return out;
  }

  // A short "body" tone sliding from `from` to `to` Hz, for the weight under a click.
  function thump(out, at, { from, to, peak, decay, type = "sine" }) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay * 0.8);
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.01);
  }

  // Like a clicky key switch: a sharp, bright click as it actuates, then ~12ms later the duller clack of the key
  // bottoming out (a low noise thud plus a very short body tone). `pitch` scales the whole thing (1 = +1's sound).
  function keyClick(pitch) {
    if (!ensureAudio()) return;
    const t = audio.currentTime;
    const out = output(0.45); // keep it quiet
    // The click: crisp, high, a few milliseconds long.
    burst(out, t, { type: "bandpass", freq: 4200 * pitch, q: 0.9, peak: 0.9, decay: 0.008 });
    burst(out, t, { type: "highpass", freq: 6000, peak: 0.25, decay: 0.004 });
    // The bottom-out clack.
    const clack = t + 0.012;
    burst(out, clack, { type: "lowpass", freq: 900 * pitch, peak: 0.6, decay: 0.03 });
    thump(out, clack, { from: 260 * pitch, to: 140 * pitch, peak: 0.35, decay: 0.03 });
  }

  // Dropping a row (swipe down): "pop-tok" — a soft, cork-like pop (a tone falling fast from 900 to 220Hz with a
  // breath of noise), landing ~45ms later on a wooden tok (a short triangle tone plus a little click).
  function dropSound() {
    if (!ensureAudio()) return;
    const t = audio.currentTime;
    const out = output(0.5);
    thump(out, t, { from: 900, to: 220, peak: 0.5, decay: 0.035 });
    burst(out, t, { type: "bandpass", freq: 1500, q: 1, peak: 0.3, decay: 0.012 });
    const tok = t + 0.045;
    thump(out, tok, { from: 520, to: 330, peak: 0.4, decay: 0.05, type: "triangle" });
    burst(out, tok, { type: "bandpass", freq: 2200, q: 1.2, peak: 0.35, decay: 0.012 });
  }

  function hapticTick() {
    if (navigator.vibrate) return void navigator.vibrate(10);
    if (!hapticSwitch) {
      hapticSwitch = document.createElement("label");
      hapticSwitch.className = "haptic";
      hapticSwitch.setAttribute("aria-hidden", "true");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      hapticSwitch.appendChild(input);
      document.body.appendChild(hapticSwitch);
    }
    const focused = document.activeElement;
    hapticSwitch.click();
    focused?.focus({ preventScroll: true }); // the click focuses the hidden switch; keep focus where it was
  }

  function countFeedback(delta) {
    try {
      keyClick(delta > 0 ? 1 : 0.57); // −1 deeper: click 2.4kHz instead of 4.2kHz, lower clack
    } catch {} // no sound is fine
    hapticTick();
  }

  // Every other button tap: a soft tick like the iOS keyboard, with a bit of body so it doesn't feel too dry — a
  // rounded band of noise around 1.5kHz, a woody tone that rings briefly, and a faint low thump underneath. ~45ms,
  // quieter than the counting click.
  function tapSound() {
    if (!ensureAudio()) return;
    const t = audio.currentTime;
    const out = output(0.3);
    burst(out, t, { type: "bandpass", freq: 1500, q: 1, peak: 0.5, decay: 0.022 });
    thump(out, t, { from: 950, to: 680, peak: 0.22, decay: 0.04, type: "triangle" });
    thump(out, t, { from: 300, to: 180, peak: 0.18, decay: 0.045 });
  }

  // Listen on the whole page (capture phase, so it runs even where a handler stops the click). The counter area is
  // a button too, but it has its own sounds.
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button || button.id === "increment" || button.disabled) return;
    try {
      tapSound();
    } catch {} // no sound is fine
  }, true);

  function change(delta) {
    const next = Math.max(0, count + delta);
    if (next === count) return;
    count = next;
    countFeedback(delta);
    render();
    // Restart the "bump" animation class so styles can animate each change.
    countEl.classList.remove("bump");
    void countEl.offsetWidth;
    countEl.classList.add("bump");
  }

  function resetCount() {
    count = 0;
    render();
  }

  // Enter: add the current count as a new row on top of the dots pile. The count stays on screen as the default
  // for the next row (swipe down again to repeat it, tap to adjust, swipe up to reset).
  function enterCount() {
    if (count === 0) return;
    entries.push(count);
    current.colors.push(current.color || DEFAULT_DOT);
    saveEntries();
    renderDots(true);
    try {
      dropSound();
    } catch {} // no sound is fine
  }

  // Main area: tap the right half = +1, the left half = −1. Swiping up or down drags the number with the
  // finger (1:1); released past COMMIT_SWIPE px, or flicked: down enters the count as a new row on the pile,
  // up resets it. Otherwise the number springs back.
  const TAP_SLOP = 10; // px a press may move and still count as a tap
  const COMMIT_SWIPE = 80; // px of vertical swipe that commits Enter (down) / Reset (up)
  const mainEl = document.getElementById("increment");
  let press = null;

  mainEl.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, swiping: false, dy: 0,
      lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    mainEl.setPointerCapture(e.pointerId);
  });

  mainEl.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.swiping) {
      if (isSelecting()) return; // while a row is selected, the main area only cancels the selection
      if (Math.abs(dy) <= TAP_SLOP || Math.abs(dy) <= Math.abs(dx)) return;
      press.swiping = true;
      document.body.classList.add("is-swiping");
    }
    // Nothing to enter or reset at 0: still follows, but with resistance, and always springs back.
    press.dy = dy * (count ? 1 : RUBBER);
    countEl.style.translate = `0 ${press.dy}px`;
    const dt = e.timeStamp - press.lastT;
    if (dt > 0) press.velocity = (e.clientY - press.lastY) / dt;
    press.lastY = e.clientY;
    press.lastT = e.timeStamp;
  });

  function endPress(e, cancelled) {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.swiping) {
      document.body.classList.remove("is-swiping");
      countEl.style.translate = ""; // CSS transition springs the number back into place
      if (cancelled) return;
      if (p.dy > 0 && (p.dy > COMMIT_SWIPE || p.velocity > FLICK_VELOCITY)) enterCount();
      else if (p.dy < 0 && (-p.dy > COMMIT_SWIPE || p.velocity < -FLICK_VELOCITY)) resetCount();
      return;
    }
    if (cancelled || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
    if (isSelecting()) clearSelection();
    else change(e.clientX < window.innerWidth / 2 ? -1 : 1);
  }

  mainEl.addEventListener("pointerup", (e) => endPress(e, false));
  mainEl.addEventListener("pointercancel", (e) => endPress(e, true));
  // Row selection: long-press a row to select it — it pops out into the row editor (see below) and Delete/Cancel
  // appear at the top. While selecting, tapping another row selects it instead and tapping elsewhere cancels.
  const LONG_PRESS_MS = 450;
  let selectedIndex = null;
  let longPress = null;
  let suppressNextDotsTap = false;

  function isSelecting() {
    return selectedIndex !== null;
  }

  // The row nearest to a screen y (rows are thin, so presses in the gaps still pick the closest one).
  function rowAt(y) {
    let best = null, bestDist = Infinity;
    for (const row of rowsEl.children) {
      const r = row.getBoundingClientRect();
      const dist = Math.abs(y - (r.top + r.bottom) / 2);
      if (dist < bestDist) {
        best = row;
        bestDist = dist;
      }
    }
    return bestDist <= 12 ? best : null;
  }

  // While selecting, the round × at the top centre (history mode's close button) cancels the selection instead.
  const doneBtn = document.getElementById("done");

  function selectRow(row) {
    selectedIndex = Number(row.dataset.index);
    for (const r of rowsEl.children) r.classList.toggle("is-selected", r === row);
    document.body.classList.add("is-selecting");
    doneBtn.setAttribute("aria-label", "Cancel selection");
    openEditor();
  }

  function clearSelection() {
    selectedIndex = null;
    rowsEl.querySelector(".is-selected")?.classList.remove("is-selected");
    document.body.classList.remove("is-selecting");
    doneBtn.setAttribute("aria-label", "Close history");
    closeEditor();
  }

  // Selection (row editor): a cream card behind the selected squares, drawn exactly over where they are in the strip
  // (same size). The rows stay in the strip underneath; the grips only include or exclude squares. Actions on the
  // selection (bottom right, while selecting): recolour (opens the colour picker) and delete. The selection is a band of rows (r1..r2, display order: 0 = newest, top) and a band
  // of columns: rows are centred on one axis, so a square's place is its centre's offset from that axis, and a square
  // is selected when that offset is within e1..e2. Side grips move e1/e2 a square (20px) at a time — one square more or
  // fewer in every selected row, whatever its length — and top/bottom grips add or drop a row (24px), within the rows
  // in view. A soft tick per change. It starts as the long-pressed row, trimmed to what fits on screen.
  const editorEl = document.getElementById("row-editor");
  const editorCard = document.getElementById("row-editor-card");
  const editorSquares = document.getElementById("row-editor-squares");
  const PITCH = 20; // px per square: 12px square + 8px gap; also the side grips' travel per square
  const ROW_PITCH = 24; // px per row: 12px row + 12px gap; also the top/bottom grips' travel per row
  // Card padding around the selected squares: 4px on every side, so it never reaches into the 8px gap far enough to
  // cover a neighbouring (excluded) square. The grips sit on the card's edges.
  const CARD_PAD = 4;
  const CARD_PAD_Y = 4;
  const RADIUS = 7; // the dots' 3px + 4px padding
  let editor = null; // { r1, r2, e1, e2, drag? }

  const groupWidth = (a, b) => (b - a) * PITCH + 12; // width of squares a..b
  const centreOffset = (i, n) => (i - (n - 1) / 2) * PITCH; // square i's centre, from the rows' axis

  // Which squares of a row (n squares) are within the column band: [first, last], or null.
  function rowRange(n) {
    const first = Math.max(0, Math.ceil(editor.e1 / PITCH + (n - 1) / 2 - 1e-6));
    const last = Math.min(n - 1, Math.floor(editor.e2 / PITCH + (n - 1) / 2 + 1e-6));
    return first <= last ? [first, last] : null;
  }

  const rowCount = (row) => entries[row.dataset.index];

  // Screen x of the middle of squares a..b in the long-pressed row (for the initial fit).
  function groupCentre(a, b) {
    const row = rowsEl.querySelector(`[data-index="${selectedIndex}"]`);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.left + a * PITCH + groupWidth(a, b) / 2, y: (r.top + r.bottom) / 2 };
  }

  // The editor's origin is #dot-rows' top-left corner on screen; follows the strip when it scrolls.
  function placeEditor() {
    if (!editor) return;
    const r = rowsEl.getBoundingClientRect();
    editorEl.style.left = `${r.left}px`;
    editorEl.style.top = `${r.top}px`;
  }

  // The selected squares of each selected row, and the card segments behind them.
  function selectedParts() {
    const parts = [];
    for (let d = editor.r1; d <= editor.r2; d++) {
      const row = rowsEl.children[d];
      const range = row && rowRange(rowCount(row));
      if (!range) continue;
      const x = row.offsetLeft + range[0] * PITCH;
      parts.push({ d, row, index: Number(row.dataset.index), range, left: x, right: x + groupWidth(...range), top: row.offsetTop });
    }
    return parts;
  }

  function renderGroup() {
    const parts = selectedParts();
    const px = (n) => `${n}px`;
    editorCard.replaceChildren(
      ...parts.map((p, k) => {
        const prev = parts[k - 1], next = parts[k + 1];
        const joinUp = prev && prev.d === p.d - 1, joinDown = next && next.d === p.d + 1;
        const seg = document.createElement("div");
        seg.className = "row-editor__seg";
        const top = p.top - (joinUp ? (ROW_PITCH - 12) / 2 : CARD_PAD_Y);
        const bottom = p.top + 12 + (joinDown ? (ROW_PITCH - 12) / 2 : CARD_PAD_Y);
        Object.assign(seg.style, { left: px(p.left - CARD_PAD), top: px(top), width: px(p.right - p.left + 2 * CARD_PAD), height: px(bottom - top) });
        // Round only the outer corners: where this segment sticks out past its neighbour (or has none).
        const r = (out) => (out ? px(RADIUS) : "0");
        seg.style.borderRadius = [
          r(!joinUp || p.left < prev.left), r(!joinUp || p.right > prev.right),
          r(!joinDown || p.right > next.right), r(!joinDown || p.left < next.left),
        ].join(" ");
        return seg;
      })
    );
    editorSquares.replaceChildren(
      ...parts.map((p) => {
        const strip = document.createElement("div");
        strip.className = "row-editor__squares";
        Object.assign(strip.style, { left: px(p.left), top: px(p.top) });
        const colors = squareColors(current.colors[p.index], entries[p.index]);
        for (let i = p.range[0]; i <= p.range[1]; i++) {
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.setProperty("--dot", colors[i]);
          strip.appendChild(dot);
        }
        return strip;
      })
    );
    // Grips: each side on the card's edge, halfway down the rows that reach furthest that way (on a stepped card the
    // selection's middle row may be narrower, leaving the grip floating); top and bottom centred on the first/last segment.
    const grip = (side, x, y) => Object.assign(editorEl.querySelector(`.row-editor__grip--${side}`).style, { left: px(x), top: px(y) });
    const edgeMidY = (reaches) => {
      // The first unbroken run of such rows (with 8, 5, 8 the middle of all of them would be the narrow row again).
      let a = parts.findIndex(reaches), b = a;
      while (parts[b + 1] && reaches(parts[b + 1]) && parts[b + 1].d === parts[b].d + 1) b++;
      return (parts[a].top + parts[b].top + 12) / 2;
    };
    if (parts.length) {
      const first = parts[0], last = parts[parts.length - 1];
      const left = Math.min(...parts.map((p) => p.left)), right = Math.max(...parts.map((p) => p.right));
      grip("left", left - CARD_PAD, edgeMidY((p) => p.left === left));
      grip("right", right + CARD_PAD, edgeMidY((p) => p.right === right));
      grip("top", (first.left + first.right) / 2, first.top - CARD_PAD_Y);
      grip("bottom", (last.left + last.right) / 2, last.top + 12 + CARD_PAD_Y);
    }
    // The colour button (bottom right) shows the selection's colour: its first square's.
    if (parts.length) {
      const first = parts[0];
      document.body.style.setProperty("--selection", squareColors(current.colors[first.index], entries[first.index])[first.range[0]]);
    }
    placeEditor();
  }

  // Rows (display indices) fully inside the strip's visible area.
  function rowsInView() {
    const view = dotsEl.getBoundingClientRect();
    const inView = [...rowsEl.children].map((row, d) => {
      const r = row.getBoundingClientRect();
      return r.top >= view.top - 1 && r.bottom <= view.bottom + 1 ? d : -1;
    }).filter((d) => d >= 0);
    return { min: Math.min(...inView), max: Math.max(...inView) };
  }

  function openEditor() {
    const anchor = rowsEl.querySelector(`[data-index="${selectedIndex}"]`);
    const n = entries[selectedIndex];
    // Start with the whole row, trimming whichever end sticks out further until the card fits on screen.
    let a = 0, b = n - 1;
    for (;;) {
      const c = groupCentre(a, b);
      const half = groupWidth(a, b) / 2 + CARD_PAD;
      const over = { left: 4 - (c.x - half), right: c.x + half - (window.innerWidth - 4) };
      if (a === b || (over.left <= 0 && over.right <= 0)) break;
      if (over.left > over.right) a++;
      else b--;
    }
    const d = [...rowsEl.children].indexOf(anchor);
    editor = { r1: d, r2: d, e1: centreOffset(a, n) - 6, e2: centreOffset(b, n) + 6 };
    editorEl.hidden = false;
    renderGroup();
  }

  function closeEditor() {
    editor = null;
    editorEl.hidden = true;
  }

  function stepFeedback() {
    try {
      tapSound();
    } catch {} // no sound is fine
    if (navigator.vibrate) navigator.vibrate(5);
  }

  for (const grip of editorEl.querySelectorAll(".row-editor__grip")) {
    grip.addEventListener("pointerdown", (e) => {
      if (!editor) return;
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const widest = Math.max(...entries);
      editor.drag = { id: e.pointerId, side: grip.dataset.side, x: e.clientX, y: e.clientY,
        start: { ...editor }, view: rowsInView(), reach: (widest - 1) * (PITCH / 2) + 6 + PITCH };
    });
    grip.addEventListener("pointermove", (e) => {
      const drag = editor?.drag;
      if (!drag || e.pointerId !== drag.id) return;
      const { start, view, reach } = drag;
      const before = JSON.stringify([editor.r1, editor.r2, editor.e1, editor.e2]);
      const cols = Math.round((e.clientX - drag.x) / PITCH) * PITCH;
      const rows = Math.round((e.clientY - drag.y) / ROW_PITCH);
      // Keep at least one square's width between the column edges, and the rows within those in view.
      if (drag.side === "left") editor.e1 = Math.max(-reach, Math.min(start.e2 - 12, start.e1 + cols));
      if (drag.side === "right") editor.e2 = Math.min(reach, Math.max(start.e1 + 12, start.e2 + cols));
      if (drag.side === "top") editor.r1 = Math.max(view.min, Math.min(start.r2, start.r1 + rows));
      if (drag.side === "bottom") editor.r2 = Math.min(view.max, Math.max(start.r1, start.r2 + rows));
      if (JSON.stringify([editor.r1, editor.r2, editor.e1, editor.e2]) !== before) {
        renderGroup();
        stepFeedback();
      }
    });
    const end = (e) => {
      if (editor?.drag && e.pointerId === editor.drag.id) editor.drag = null;
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  // Moving the selection, keeping its size: w squares across (the column band's width) by h rows. Tapping a square
  // outside it moves it there (centred on that square); dragging from inside the card moves it along square by
  // square and row by row. Near a row's end it slides inward rather than shrinking; on a row shorter than w it takes
  // the whole row (after a tap that becomes the new size; while dragging, the size held at the start comes back on
  // longer rows). Long-pressing inside the card selects that whole row, like long-pressing a row anywhere.
  const selWidth = () => Math.round((editor.e2 - editor.e1 - 12) / PITCH) + 1;
  const selHeight = () => editor.r2 - editor.r1 + 1;

  // Index of the square of `row` nearest to screen x.
  function squareAt(row, x) {
    const n = rowCount(row);
    return Math.max(0, Math.min(n - 1, Math.round((x - row.getBoundingClientRect().left - 6) / PITCH)));
  }

  // Place a w × h selection with square i of display row d at its centre (for an even w, the tapped square is the
  // left one of the middle two), kept within the row's squares and, when it fits, within the rows in view.
  function placeSelection(d, i, w, h) {
    const rows = rowsEl.children, row = rows[d], n = rowCount(row);
    const ww = Math.min(w, n);
    const a = Math.max(0, Math.min(n - ww, i - Math.floor((ww - 1) / 2)));
    const view = rowsInView();
    const [lo, hi] = h <= view.max - view.min + 1 ? [view.min, view.max - h + 1] : [0, rows.length - h];
    const r1 = Math.max(lo, Math.min(hi, d - Math.floor((h - 1) / 2)));
    const next = { r1, r2: r1 + h - 1, e1: centreOffset(a, n) - 6, e2: centreOffset(a + ww - 1, n) + 6 };
    const changed = ["r1", "r2", "e1", "e2"].some((k) => next[k] !== editor[k]);
    Object.assign(editor, next);
    selectedIndex = Number(row.dataset.index);
    for (const r of rows) r.classList.toggle("is-selected", r === row);
    if (changed) renderGroup();
    return changed;
  }

  // A tap on the strip while selecting: move the selection to the tapped square.
  function moveSelectionTo(row, x) {
    if (placeSelection([...rowsEl.children].indexOf(row), squareAt(row, x), selWidth(), selHeight())) stepFeedback();
  }

  // Screen point of the selection's centre: its middle row, and the middle of the column band (rows share one axis).
  function selectionCentre() {
    const r = rowsEl.getBoundingClientRect();
    const mid = rowsEl.children[editor.r1 + Math.floor((selHeight() - 1) / 2)].getBoundingClientRect();
    return { x: r.left + r.width / 2 + (editor.e1 + editor.e2) / 2, y: (mid.top + mid.bottom) / 2 };
  }

  // The display row nearest to screen y, limited to the rows in view.
  function rowNear(y) {
    const view = rowsInView();
    let best = view.min, bestDist = Infinity;
    for (let d = view.min; d <= view.max; d++) {
      const r = rowsEl.children[d].getBoundingClientRect();
      const dist = Math.abs(y - (r.top + r.bottom) / 2);
      if (dist < bestDist) [best, bestDist] = [d, dist];
    }
    return best;
  }

  let cardPress = null; // { id, x, y, w, h, centre, timer, moving }

  // The press is captured by the card itself (touches are otherwise held by the segment first touched, and segments
  // are rebuilt while moving) and followed on window: capture only takes effect from the next event, and a quick
  // first move could land on the strip and be lost (then the long-press timer fired and reselected the whole row).
  editorCard.addEventListener("pointerdown", (e) => {
    if (!editor || !e.isPrimary) return;
    e.stopPropagation();
    editorCard.setPointerCapture(e.pointerId);
    cardPress = { id: e.pointerId, x: e.clientX, y: e.clientY, w: selWidth(), h: selHeight(), centre: selectionCentre(), moving: false };
    cardPress.timer = setTimeout(() => {
      const row = rowAt(cardPress.y);
      cardPress = null;
      if (navigator.vibrate) navigator.vibrate(15);
      if (row) selectRow(row);
    }, LONG_PRESS_MS);
  });

  window.addEventListener("pointermove", (e) => {
    const press = cardPress;
    if (!press || e.pointerId !== press.id || !editor) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.moving) {
      if (Math.hypot(dx, dy) <= TAP_SLOP) return;
      press.moving = true;
      clearTimeout(press.timer);
    }
    // Where the selection's centre would be, then the square there (for an even width the centre sits half a square
    // right of the "centre" square).
    const tx = press.centre.x + dx - (press.w % 2 ? 0 : PITCH / 2), ty = press.centre.y + dy;
    const d = rowNear(ty);
    if (placeSelection(d, squareAt(rowsEl.children[d], tx), press.w, press.h)) stepFeedback();
  });

  const endCardPress = (e) => {
    if (!cardPress || e.pointerId !== cardPress.id) return;
    clearTimeout(cardPress.timer);
    cardPress = null;
  };
  window.addEventListener("pointerup", endCardPress);
  window.addEventListener("pointercancel", endCardPress);

  dotsEl.addEventListener("scroll", placeEditor);
  scrollerEl.addEventListener("scroll", placeEditor);
  window.addEventListener("resize", placeEditor);

  // Delete removes the selected squares from each selected row (a row with none left is removed); the other squares
  // keep their own colours.
  function deleteSelected() {
    if (!isSelecting()) return;
    const cuts = editor
      ? selectedParts().map((p) => ({ index: p.index, range: p.range }))
      : [{ index: selectedIndex, range: [0, entries[selectedIndex] - 1] }];
    for (const { index, range } of cuts.sort((x, y) => y.index - x.index)) {
      const colors = squareColors(current.colors[index], entries[index]);
      colors.splice(range[0], range[1] - range[0] + 1);
      if (colors.length === 0) {
        entries.splice(index, 1);
        current.colors.splice(index, 1);
      } else {
        entries[index] = colors.length;
        current.colors[index] = packColors(colors);
      }
    }
    saveEntries();
    clearSelection();
    renderDots(false, true);
    if (isHistory()) {
      if (entries.length === 0) closeHistory();
      else animateTo(openHeight());
    }
  }

  // Recolour the selected squares (live, from the colour picker): the rows' own dots and the card's copies.
  function colorSelection(hex) {
    for (const p of selectedParts()) {
      const colors = squareColors(current.colors[p.index], entries[p.index]);
      for (let i = p.range[0]; i <= p.range[1]; i++) colors[i] = hex;
      current.colors[p.index] = packColors(colors);
      const dots = p.row.querySelectorAll(".dot");
      p.row.style.removeProperty("--dot");
      colors.forEach((c, i) => dots[i].style.setProperty("--dot", c));
    }
    renderGroup();
  }

  dotsEl.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    const row = rowAt(e.clientY);
    if (!row) return;
    longPress = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      longPress = null;
      drag = null; // a long-press is not the start of an open drag
      suppressNextDotsTap = true; // ...nor a tap
      if (navigator.vibrate) navigator.vibrate(15);
      selectRow(row);
    }, LONG_PRESS_MS) };
  });

  dotsEl.addEventListener("pointermove", (e) => {
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > TAP_SLOP) {
      clearTimeout(longPress.timer);
      longPress = null;
    }
  });

  for (const type of ["pointerup", "pointercancel"]) {
    dotsEl.addEventListener(type, () => {
      if (longPress) clearTimeout(longPress.timer);
      longPress = null;
    });
  }

  document.getElementById("select-delete").addEventListener("click", deleteSelected);

  // Projects UI. The app opens on Home: a loose pile of project balls (newest at the bottom, resting on the +
  // button). Tap a ball to open that project's counter, long-press it to select it for deletion, + starts a new
  // project. On the counter, the round back pill returns Home and the title pill (top centre) renames.
  const homeEl = document.getElementById("home");
  const pileEl = document.getElementById("home-pile");
  const ballsEl = document.getElementById("projects-list");
  const titleEl = document.getElementById("project-title");

  const isHome = () => document.body.classList.contains("is-home");

  function renderTitle() {
    titleEl.textContent = current.name;
  }

  // An untouched project (no dots, default name) isn't worth keeping when you leave it, and isn't shown on Home.
  function isBlank(project) {
    return project.entries.length === 0 && project.name === DEFAULT_NAME;
  }

  function showHome() {
    clearSelection();
    if (isHistory()) closeHistory();
    if (isBlank(current)) projects = projects.filter((p) => p !== current);
    persistProjects();
    document.body.classList.add("is-home");
    setInert();
    refreshHome(); // newest balls (at the bottom) in view
  }

  function openProject(project) {
    clearBallSelection();
    if (project !== current && isBlank(current)) projects = projects.filter((p) => p !== current);
    if (!projects.includes(project)) projects.unshift(project);
    current = project;
    entries = current.entries;
    persistProjects();
    count = entries.length ? entries[entries.length - 1] : 0; // each project opens on its last row's number
    render();
    applyDotColor();
    renderDots(false);
    renderTitle();
    document.body.classList.remove("is-home");
    setInert();
  }

  function newProject() {
    openProject(isBlank(current) ? current : makeProject());
  }

  // Keep keyboard focus and screen readers on whichever screen is showing.
  function setInert() {
    homeEl.inert = !isHome();
    for (const el of document.body.children) {
      if (el !== homeEl && el.tagName !== "SCRIPT") el.inert = isHome();
    }
  }

  // Pile layout: balls are dropped one at a time, newest first, each into the lowest free spot inside the content
  // area — resting on the floor, a side wall, the + button or balls already placed — like a pile of balls. The
  // newest is full size (204px, the Figma ball); older ones get smaller, down to MIN_BALL.
  // Coordinates are ball centres relative to .home__main's top-left (y down).
  const BALL = 204;
  const MIN_BALL = 108;
  const BALL_GAP = 10; // between balls (and between a ball and the + button)

  function ballSize(i) {
    return i === 0 ? BALL : Math.max(MIN_BALL, Math.round(160 * 0.9 ** (i - 1)));
  }

  // `plus` = the + button, a round obstacle on the floor ({ x, y, r } in the same coordinates).
  function pileLayout(count, width, height, plus) {
    const placed = [plus];
    const RECENT = 12; // only rest new balls on the most recent ones (older ones are buried) — keeps this fast
    for (let i = 0; i < count; i++) {
      const r = ballSize(i) / 2;
      const minX = r, maxX = Math.max(r, width - r), floor = height - r;
      const near = [placed[0], ...placed.slice(-RECENT).filter((b) => b !== placed[0])];
      const reach = (b) => b.r + r + BALL_GAP;
      const candidates = [{ x: minX, y: floor }, { x: maxX, y: floor }];
      for (const b of near) {
        const R = reach(b);
        // On the floor, touching b.
        const dy = floor - b.y;
        if (Math.abs(dy) <= R) {
          const dx = Math.sqrt(R * R - dy * dy);
          candidates.push({ x: b.x - dx, y: floor }, { x: b.x + dx, y: floor });
        }
        // Against a wall, touching b.
        for (const x of [minX, maxX]) {
          const ddx = x - b.x;
          if (Math.abs(ddx) <= R) {
            const ddy = Math.sqrt(R * R - ddx * ddx);
            candidates.push({ x, y: b.y - ddy }, { x, y: b.y + ddy });
          }
        }
      }
      // Touching two balls at once.
      for (let a = 0; a < near.length; a++) {
        for (let c = a + 1; c < near.length; c++) {
          const p = near[a], q = near[c], Rp = reach(p), Rq = reach(q);
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
          if (d === 0 || d > Rp + Rq || d < Math.abs(Rp - Rq)) continue;
          const along = (Rp * Rp - Rq * Rq + d * d) / (2 * d), h = Math.sqrt(Math.max(0, Rp * Rp - along * along));
          const mx = p.x + (dx * along) / d, my = p.y + (dy * along) / d;
          candidates.push({ x: mx - (dy * h) / d, y: my + (dx * h) / d }, { x: mx + (dy * h) / d, y: my - (dx * h) / d });
        }
      }
      // Lowest spot that fits wins; on a tie, the leftmost.
      let best = null;
      for (const { x, y } of candidates) {
        if (x < minX - 0.5 || x > maxX + 0.5 || y > floor + 0.5) continue;
        if (placed.some((b) => Math.hypot(x - b.x, y - b.y) < reach(b) - 0.5)) continue;
        if (!best || y > best.y + 0.5 || (Math.abs(y - best.y) <= 0.5 && x < best.x)) best = { x, y };
      }
      if (!best) best = { x: minX, y: Math.min(...placed.map((b) => b.y - reach(b))) }; // nowhere to rest: stack on top
      placed.push({ x: best.x, y: best.y, r });
    }
    return placed.slice(1);
  }

  function renderHome() {
    const list = projects.filter((p) => !isBlank(p)).sort((a, b) => b.updatedAt - a.updatedAt);
    const content = homeEl.querySelector(".home__main").getBoundingClientRect();
    const pile = pileEl.getBoundingClientRect();
    const plusRect = homeEl.querySelector(".home__new").getBoundingClientRect();
    const plus = { x: plusRect.left + plusRect.width / 2 - content.left, y: plusRect.top + plusRect.height / 2 - content.top,
      r: Math.max(plusRect.width, plusRect.height) / 2 };
    const spots = pileLayout(list.length, content.width, content.height, plus);
    // The pile bleeds past the side and bottom padding, and grows upward (scrollable) when the balls don't fit.
    const left = content.left - pile.left, top = content.top - pile.top; // top: 0 (the pile starts below the title)
    const above = Math.max(0, ...spots.map((s) => 16 - (s.y - s.r))); // room needed above the content top
    const height = top + above + content.height + (pile.bottom - content.bottom);
    ballsEl.style.height = `${height}px`;
    ballsEl.replaceChildren(
      ...list.map((project, i) => {
        const { x, y, r } = spots[i];
        const item = document.createElement("li");
        item.className = "ball";
        item.dataset.id = project.id;
        // Whole pixels for crisp edges.
        Object.assign(item.style, { left: `${Math.round(left + x - r)}px`, top: `${Math.round(top + above + y - r)}px`,
          width: `${2 * r}px`, height: `${2 * r}px` });

        const open = document.createElement("button");
        open.type = "button";
        open.className = "ball__open";
        const total = project.entries.reduce((a, b) => a + b, 0);
        open.setAttribute("aria-label", `${project.name}, ${project.entries.length} rows, ${total} dots`);
        open.append(ballPreview(project, 2 * r), ballLabel(project));
        item.appendChild(open);
        return item;
      })
    );
    for (const text of ballsEl.querySelectorAll("text")) fitLabel(text);
  }

  // Preview inside a ball: the middle of the project's dots pile, laid out like the counter's strip (same 12px
  // dots and gaps, newest row on top, each row in its own colour), centred in the
  // ball and clipped by it. Only the rows and dots that can show are built: the middle slice of rows, and long rows
  // cut down to their middle dots (same parity, so the visible dots sit exactly where they would in the full row).
  function ballPreview(project, size) {
    const preview = document.createElement("div");
    preview.className = "ball__preview";
    const rows = project.entries.slice().reverse();
    let shown = Math.min(rows.length, Math.ceil(size / 24) + 1); // 12px row + 12px gap
    if ((rows.length - shown) % 2) shown++; // keep the slice centred on the pile's middle
    const start = (rows.length - shown) / 2;
    const maxDots = Math.ceil(size / 20) + 2; // 12px dot + 8px gap
    preview.append(
      ...rows.slice(start, start + shown).map((n, j) => {
        const cut = n > maxDots ? maxDots + ((n - maxDots) % 2) : n;
        const color = project.colors[rows.length - 1 - (start + j)];
        const skip = (n - cut) / 2; // a cut row shows its middle squares
        return buildRow(cut, Array.isArray(color) ? color.slice(skip, skip + cut) : color);
      })
    );
    preview.appendChild(ballBand());
    return preview;
  }

  // The name runs along the bottom of the ball: an SVG textPath on a circle inset 10 units from the edge (r = 92,
  // in the 204-unit viewBox), traced counter-clockwise from the top so text along the bottom reads upright, glyphs
  // inside the ball. It sits on a solid label (.ball__band, see drawBand).
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LABEL_R = 92;
  const LABEL_CENTER = (Math.PI + 0.28) * LABEL_R; // arc length from the top to the label's middle (just right of bottom)
  const LABEL_MAX = 250; // px of arc a name may use before it shrinks

  function ballLabel(project) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ball__label");
    svg.setAttribute("viewBox", `0 0 ${BALL} ${BALL}`); // drawn at full size; scales down with smaller balls
    svg.setAttribute("aria-hidden", "true");
    const c = BALL / 2, id = `ball-arc-${project.id}`;
    const path = document.createElementNS(SVG_NS, "path");
    path.id = id;
    path.setAttribute("fill", "none");
    path.setAttribute("d", `M ${c} ${c - LABEL_R} A ${LABEL_R} ${LABEL_R} 0 1 0 ${c} ${c + LABEL_R} A ${LABEL_R} ${LABEL_R} 0 1 0 ${c} ${c - LABEL_R}`);
    const text = document.createElementNS(SVG_NS, "text");
    const textPath = document.createElementNS(SVG_NS, "textPath");
    textPath.setAttribute("href", `#${id}`);
    textPath.setAttribute("startOffset", LABEL_CENTER);
    textPath.setAttribute("text-anchor", "middle");
    textPath.textContent = project.name;
    text.appendChild(textPath);
    svg.append(path, text);
    return svg;
  }

  // The label behind the name: a tab rising from the ball's rim — cream, with a brown line along its top edge and
  // two sides, rounded top corners, and its bottom running into the ball's border. It lives inside the dots preview,
  // so it's clipped exactly at the inside edge of the border. Same 204-unit coordinates as the name; drawn by
  // drawBand once the text has been measured.
  function ballBand() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ball__band");
    svg.setAttribute("viewBox", `0 0 ${BALL} ${BALL}`);
    svg.setAttribute("aria-hidden", "true");
    for (const cls of ["ball__band-fill", "ball__band-edge"]) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("class", cls);
      svg.appendChild(p);
    }
    return svg;
  }

  // Tab geometry, in polar coordinates around the ball's centre (angle = arc length / radius, counter-clockwise from
  // the top, as for the name's path): sides are radial lines just beyond the ends of the text, the top edge an arc a
  // little above the letters with rounded corners, and at the bottom each side rounds inward (a convex corner) to
  // meet the rim tangentially. The rim is the inside edge of the ball's border (an ellipse: the border is 1px, 3px
  // at the bottom). The line is converted from CSS px so it stays 1px whatever the ball's size.
  const TAB_PAD = 10; // space beside the text, at the top edge
  const TAB_CORNER = 8; // top corner radius
  const TAB_FOOT = 8; // bottom corner radius

  function drawBand(text) {
    const length = text.getComputedTextLength();
    const band = text.closest(".ball__open").querySelector(".ball__band");
    band.style.display = length ? "" : "none";
    if (!length) return;
    const fontSize = parseFloat(text.style.fontSize) || 20;
    const px = BALL / parseFloat(text.closest(".ball").style.width); // viewBox units per CSS px
    const c = BALL / 2;
    const top = LABEL_R - 0.72 * fontSize - 6; // radius of the top edge: cap height + a little air
    const mid = LABEL_CENTER / LABEL_R;
    const half = length / 2 / LABEL_R + TAB_PAD / top;
    const a1 = mid - half, a2 = mid + half;
    const pt = (r, a) => `${(c - r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
    // Distance from the centre to the rim along angle a (ray / inner-edge ellipse intersection).
    const rx = c - px, ry = c - 2 * px, oy = -px; // ellipse centre is px above the ball's centre
    const rim = (a) => {
      const dx = -Math.sin(a), dy = -Math.cos(a);
      const A = (dx / rx) ** 2 + (dy / ry) ** 2, B = (2 * dy * -oy) / ry ** 2, C = (oy / ry) ** 2 - 1;
      return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    };
    const r1 = rim(a1), r2 = rim(a2);
    const f1 = a1 + TAB_FOOT / r1, f2 = a2 - TAB_FOOT / r2; // where the bottom corners land on the rim
    const k = TAB_CORNER / top; // top corner length along the top arc, as an angle
    const large = a2 - a1 - 2 * k > Math.PI ? 1 : 0;
    // Bottom corner, side, top corner, top arc, top corner, side, bottom corner (all rounded).
    const edge = `M ${pt(rim(f1), f1)} Q ${pt(r1, a1)} ${pt(r1 - TAB_FOOT, a1)} ` +
      `L ${pt(top + TAB_CORNER, a1)} Q ${pt(top, a1)} ${pt(top, a1 + k)} ` +
      `A ${top} ${top} 0 ${large} 0 ${pt(top, a2 - k)} Q ${pt(top, a2)} ${pt(top + TAB_CORNER, a2)} ` +
      `L ${pt(r2 - TAB_FOOT, a2)} Q ${pt(r2, a2)} ${pt(rim(f2), f2)}`;
    const out = c + 8; // past the rim (clipped there)
    const [fill, line] = band.children;
    fill.setAttribute("d", `${edge} L ${pt(out, f2)} A ${out} ${out} 0 ${f2 - f1 > Math.PI ? 1 : 0} 1 ${pt(out, f1)} Z`);
    line.setAttribute("d", edge);
    line.setAttribute("stroke-width", px);
  }

  // Long names shrink to fit the arc (down to 14px), then get an ellipsis. Then the label is drawn to match.
  function fitLabel(text) {
    shrinkLabel(text);
    drawBand(text);
  }

  function shrinkLabel(text) {
    const textPath = text.firstChild;
    const full = textPath.textContent;
    const length = text.getComputedTextLength();
    if (length <= LABEL_MAX) return;
    const size = Math.max(14, Math.floor(20 * LABEL_MAX / length));
    text.style.fontSize = `${size}px`;
    for (let n = full.length; n > 1 && text.getComputedTextLength() > LABEL_MAX; n--) {
      textPath.textContent = full.slice(0, n).trimEnd() + "…";
    }
  }

  // Ball taps and long-press selection. While a ball is selected: tapping another selects it, tapping anywhere
  // else (or Esc, or Cancel) cancels; Delete removes the project (no undo).
  let selectedBall = null;
  let ballPress = null;
  let suppressBallClick = false;

  function selectBall(item) {
    selectedBall = item;
    for (const b of ballsEl.children) b.classList.toggle("is-selected", b === item);
    homeEl.classList.add("is-selecting");
  }

  function clearBallSelection() {
    selectedBall = null;
    ballsEl.querySelector(".is-selected")?.classList.remove("is-selected");
    homeEl.classList.remove("is-selecting");
  }

  function deleteSelectedProject() {
    if (!selectedBall) return;
    const project = projects.find((p) => p.id === selectedBall.dataset.id);
    clearBallSelection();
    if (!project) return;
    projects = projects.filter((p) => p !== project);
    if (project === current) {
      current = projects.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] || makeProject();
      if (!projects.includes(current)) projects.unshift(current);
      entries = current.entries;
      renderDots(false);
      renderTitle();
    }
    persistProjects();
    const scroll = pileEl.scrollHeight - pileEl.scrollTop; // keep the view anchored to the bottom of the pile
    renderHome();
    pileEl.scrollTop = pileEl.scrollHeight - scroll;
  }

  ballsEl.addEventListener("pointerdown", (e) => {
    const item = e.target.closest(".ball");
    if (!e.isPrimary || !item) return;
    ballPress = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      ballPress = null;
      suppressBallClick = true;
      if (navigator.vibrate) navigator.vibrate(15);
      selectBall(item);
    }, LONG_PRESS_MS) };
  });

  ballsEl.addEventListener("pointermove", (e) => {
    if (ballPress && Math.hypot(e.clientX - ballPress.x, e.clientY - ballPress.y) > TAP_SLOP) {
      clearTimeout(ballPress.timer);
      ballPress = null;
    }
  });

  for (const type of ["pointerup", "pointercancel"]) {
    ballsEl.addEventListener(type, () => {
      if (ballPress) clearTimeout(ballPress.timer);
      ballPress = null;
    });
  }

  ballsEl.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press is ours, not the browser's

  ballsEl.addEventListener("click", (e) => {
    const item = e.target.closest(".ball");
    if (suppressBallClick) {
      suppressBallClick = false;
      return;
    }
    if (!item) return;
    if (selectedBall) return selectBall(item);
    const project = projects.find((p) => p.id === item.dataset.id);
    if (project) openProject(project);
  });

  // Tapping empty space on Home cancels a selection.
  homeEl.addEventListener("click", (e) => {
    if (selectedBall && !e.target.closest(".ball, .home__select")) clearBallSelection();
  });

  // Re-lay the pile (and show its bottom again) when the screen size changes.
  function refreshHome() {
    if (!isHome()) return;
    renderHome();
    pileEl.scrollTop = pileEl.scrollHeight;
  }

  window.addEventListener("resize", refreshHome);

  // Rename: tapping the title pill opens the rename layer with the keyboard up. The field starts empty with the
  // current name as its placeholder; once something is typed the × becomes a ✓. ✓ / Enter saves, × / Esc cancels,
  // and dismissing the keyboard saves whatever was typed.
  const renameEl = document.getElementById("rename");
  const renameInput = document.getElementById("rename-input");
  const renameAction = document.getElementById("rename-action");
  const isRenaming = () => document.body.classList.contains("is-renaming");
  const hasName = () => renameInput.value.trim() !== "";

  function openRename() {
    clearSelection();
    renameInput.value = "";
    renameInput.placeholder = current.name;
    updateRenameAction();
    trackKeyboard();
    document.body.classList.add("is-renaming");
    renameInput.focus(); // synchronously inside the tap, so mobile browsers bring up the keyboard
  }

  function closeRename(save) {
    if (!isRenaming()) return;
    const name = renameInput.value.replace(/\s+/g, " ").trim().slice(0, 40);
    if (save && name && name !== current.name) {
      current.name = name;
      current.updatedAt = Date.now();
      persistProjects();
      renderTitle();
    }
    document.body.classList.remove("is-renaming");
    renameInput.blur();
  }

  function updateRenameAction() {
    renameEl.classList.toggle("is-filled", hasName());
    renameAction.setAttribute("aria-label", hasName() ? "Save name" : "Cancel");
  }

  // Keep the field just above the on-screen keyboard: --kb = the part of the layout viewport the keyboard covers.
  function trackKeyboard() {
    const vv = window.visualViewport;
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    renameEl.style.setProperty("--kb", `${kb}px`);
  }

  window.visualViewport?.addEventListener("resize", trackKeyboard);
  window.visualViewport?.addEventListener("scroll", trackKeyboard);

  document.getElementById("rename-open").addEventListener("click", openRename);
  renameInput.addEventListener("input", updateRenameAction);
  // Keep focus in the field while pressing the button (so the blur handler doesn't run first).
  renameAction.addEventListener("pointerdown", (e) => e.preventDefault());
  renameAction.addEventListener("click", () => closeRename(hasName()));
  renameEl.addEventListener("submit", (e) => {
    e.preventDefault();
    closeRename(true);
  });
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRename(false);
    }
  });
  renameInput.addEventListener("blur", () => closeRename(true));

  // Dot colour: each project has a current colour (`color`, default brown) used for the rows entered from now on;
  // rows already in the pile keep the colour they were entered with (`colors`). The top-right circle shows the
  // current colour; tapping it opens a picker — a saturation (x) / brightness (y) gradient panel, a hue strip, and a
  // swatch for each colour already used in the rows. Every pick is saved straight away (on release, swatch tap or
  // arrow key); closing (outside tap, the circle again, Esc) keeps it.
  const pickerEl = document.getElementById("color-picker");
  const colorOpen = document.getElementById("color-open");
  const svEl = document.getElementById("picker-sv");
  const hueEl = document.getElementById("picker-hue");
  const svThumb = document.getElementById("picker-sv-thumb");
  const hueThumb = document.getElementById("picker-hue-thumb");
  const swatchesEl = document.getElementById("picker-swatches");
  const usedEl = document.getElementById("picker-used"); // "In this project:" + the swatches
  const selectColor = document.getElementById("select-color");
  const isPicking = () => document.body.classList.contains("is-picking");
  let hsv = { h: 0, s: 0, v: 0 };

  function applyDotColor() {
    document.body.style.setProperty("--dot", current.color || DEFAULT_DOT);
  }

  function hsvToHex({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return "#" + [f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }

  // `hex` is passed when an exact colour is known (opening, swatches), so it isn't rounded through HSV.
  function renderPicker(hex = hsvToHex(hsv)) {
    pickerEl.style.setProperty("--hue", hsv.h);
    pickerEl.style.setProperty("--picked", hex);
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    svEl.setAttribute("aria-valuetext", `saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
    hueEl.setAttribute("aria-valuenow", Math.round(hsv.h));
    if (isSelecting()) {
      colorSelection(hex); // a selection's colour: only its squares change
    } else {
      current.color = hex;
      applyDotColor();
    }
    for (const s of swatchesEl.children) {
      const on = s.dataset.color === hex;
      s.classList.toggle("is-selected", on);
      s.setAttribute("aria-pressed", on);
    }
  }

  // Swatches: the distinct colours of this project's rows, most recently used first. Tapping one picks it.
  function renderSwatches() {
    const used = [...new Set(current.colors.slice().reverse().flat())];
    usedEl.hidden = used.length === 0;
    swatchesEl.replaceChildren(
      ...used.map((color) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "picker__swatch";
        swatch.dataset.color = color;
        swatch.style.setProperty("--swatch", color);
        swatch.setAttribute("aria-label", `Use ${color}`);
        swatch.addEventListener("click", () => {
          hsv = hexToHsv(color);
          renderPicker(color);
          saveColor();
        });
        return swatch;
      })
    );
  }

  function saveColor() {
    current.updatedAt = Date.now();
    persistProjects();
  }

  // Opened from the top-right circle it sets the colour for new rows; opened from the selection's colour button
  // (bottom right) it recolours the selected squares, starting from their colour.
  function openPicker() {
    const start = isSelecting() ? document.body.style.getPropertyValue("--selection") : current.color || DEFAULT_DOT;
    renderSwatches();
    hsv = hexToHsv(start);
    renderPicker(start);
    document.body.classList.add("is-picking");
    for (const b of [colorOpen, selectColor]) b.setAttribute("aria-expanded", "true");
  }

  function closePicker() {
    document.body.classList.remove("is-picking");
    for (const b of [colorOpen, selectColor]) b.setAttribute("aria-expanded", "false");
  }

  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  // Drag (or tap) anywhere on the panel / strip; the thumb jumps under the finger and follows it.
  function dragOn(el, update) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      update(e, el.getBoundingClientRect());
    });
    el.addEventListener("pointermove", (e) => {
      if (el.hasPointerCapture(e.pointerId)) update(e, el.getBoundingClientRect());
    });
    el.addEventListener("pointerup", saveColor);
    el.addEventListener("pointercancel", saveColor);
  }

  dragOn(svEl, (e, r) => {
    hsv.s = clamp01((e.clientX - r.left) / r.width);
    hsv.v = 1 - clamp01((e.clientY - r.top) / r.height);
    renderPicker();
  });
  dragOn(hueEl, (e, r) => {
    hsv.h = clamp01((e.clientX - r.left) / r.width) * 359.99;
    renderPicker();
  });

  // Keyboard: arrows nudge the values (Shift = bigger steps).
  function nudge(el, keys) {
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1, change = keys[e.key];
      if (!change) return;
      e.preventDefault();
      change(step);
      renderPicker();
      saveColor();
    });
  }

  nudge(svEl, {
    ArrowLeft: (n) => (hsv.s = clamp01(hsv.s - n / 100)),
    ArrowRight: (n) => (hsv.s = clamp01(hsv.s + n / 100)),
    ArrowUp: (n) => (hsv.v = clamp01(hsv.v + n / 100)),
    ArrowDown: (n) => (hsv.v = clamp01(hsv.v - n / 100)),
  });
  nudge(hueEl, {
    ArrowLeft: (n) => (hsv.h = (hsv.h - n + 360) % 360),
    ArrowRight: (n) => (hsv.h = (hsv.h + n) % 360),
  });

  colorOpen.addEventListener("click", () => (isPicking() ? closePicker() : openPicker()));
  selectColor.addEventListener("click", () => (isPicking() ? closePicker() : openPicker()));
  document.getElementById("picker-backdrop").addEventListener("click", () => closePicker());

  document.getElementById("back").addEventListener("click", showHome);
  document.getElementById("new-project").addEventListener("click", (e) => {
    e.stopPropagation(); // not a "tap on empty space"
    if (selectedBall) clearBallSelection();
    else newProject();
  });
  document.getElementById("cancel-project").addEventListener("click", clearBallSelection);
  document.getElementById("delete-project").addEventListener("click", deleteSelectedProject);

  // Backup (the ⋯ button on Home). Projects only live in this browser's storage, so "Back up projects" saves them all
  // to a JSON file — through the share sheet where it can (iPhone: Save to Files / iCloud Drive), else a download —
  // and "Restore a backup" loads one back. Restoring merges: projects not here are added; ones that are keep
  // whichever copy was changed more recently. Nothing is ever removed. The card notes when the last backup was made.
  const BACKUP_KEY = "counter:last-backup";
  const moreBtn = document.getElementById("home-more");
  const backupNote = document.getElementById("backup-note");
  const restoreFile = document.getElementById("restore-file");
  const isMenuOpen = () => homeEl.classList.contains("is-menu");

  function showLastBackup() {
    const at = Number(localStorage.getItem(BACKUP_KEY));
    backupNote.textContent = at ? `Last backup: ${dateFormat.format(at)}` : "Not backed up yet";
  }

  function openMenu() {
    clearBallSelection();
    showLastBackup();
    homeEl.classList.add("is-menu");
    moreBtn.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    homeEl.classList.remove("is-menu");
    moreBtn.setAttribute("aria-expanded", "false");
  }

  async function backUp() {
    const day = new Date().toISOString().slice(0, 10);
    const data = { app: "ribbit", version: 1, exportedAt: new Date().toISOString(), projects: projects.filter((p) => !isBlank(p)) };
    const file = new File([JSON.stringify(data, null, 2)], `ribbit-backup-${day}.json`, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } catch (err) {
      if (err.name !== "AbortError") backupNote.textContent = "Couldn't save the backup.";
      return; // cancelled the share sheet: not backed up
    }
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    showLastBackup();
  }

  // A project from a backup file, checked and tidied like stored ones (cleanProject); null if it isn't one.
  function importedProject(p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.entries)) return null;
    const name = typeof p.name === "string" && p.name.trim() ? p.name.replace(/\s+/g, " ").trim().slice(0, 40) : DEFAULT_NAME;
    const project = cleanProject({
      id: typeof p.id === "string" && p.id ? p.id : makeProject().id,
      name,
      updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
      entries: p.entries,
      colors: p.colors,
      ...(typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color } : {}),
    });
    return isBlank(project) ? null : project;
  }

  function restore(text) {
    let list;
    try {
      const data = JSON.parse(text);
      list = Array.isArray(data) ? data : data?.projects;
    } catch {}
    const incoming = Array.isArray(list) ? list.map(importedProject).filter(Boolean) : [];
    if (!incoming.length) {
      backupNote.textContent = "That file isn't a Ribbit backup.";
      return;
    }
    let added = 0, updated = 0;
    for (const p of incoming) {
      const i = projects.findIndex((q) => q.id === p.id);
      if (i < 0) {
        projects.push(p);
        added++;
      } else if (p.updatedAt > projects[i].updatedAt) {
        if (projects[i] === current) {
          current = p;
          entries = current.entries;
        }
        projects[i] = p;
        updated++;
      }
    }
    persistProjects();
    refreshHome();
    const parts = [added && `${added} added`, updated && `${updated} updated`].filter(Boolean);
    backupNote.textContent = parts.length ? `Restored: ${parts.join(", ")}` : "Everything in that backup is already here.";
  }

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // not a "tap on empty space"
    isMenuOpen() ? closeMenu() : openMenu();
  });
  document.getElementById("home-menu-backdrop").addEventListener("click", closeMenu);
  document.getElementById("backup").addEventListener("click", backUp);
  document.getElementById("restore").addEventListener("click", () => restoreFile.click());
  restoreFile.addEventListener("change", async () => {
    const file = restoreFile.files[0];
    restoreFile.value = ""; // so picking the same file again still fires
    if (file) restore(await file.text());
  });

  // Double-tap on the dots (either mode): glide the group back to center horizontally.
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_DISTANCE = 40; // px between the two taps
  let dotsPress = null;
  let lastDotsTap = null;

  dotsEl.addEventListener("pointerdown", (e) => {
    if (e.isPrimary) dotsPress = { x: e.clientX, y: e.clientY };
  });

  dotsEl.addEventListener("pointerup", (e) => {
    const p = dotsPress;
    dotsPress = null;
    if (suppressNextDotsTap) {
      suppressNextDotsTap = false;
      return;
    }
    if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
    if (isSelecting()) {
      // Taps on the card itself never get here; a tap on any other square moves the selection there.
      const row = rowAt(e.clientY);
      if (!row) clearSelection();
      else if (editor) moveSelectionTo(row, e.clientX);
      else selectRow(row);
      return;
    }
    const isDouble = lastDotsTap && e.timeStamp - lastDotsTap.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastDotsTap.x, e.clientY - lastDotsTap.y) < DOUBLE_TAP_DISTANCE;
    if (isDouble) {
      lastDotsTap = null;
      centerDots(true);
    } else {
      lastDotsTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    }
  });

  dotsEl.addEventListener("pointercancel", () => {
    dotsPress = null;
  });

  // Keyboard activation (Enter/Space on the focused button) has no pointer position: +1.
  mainEl.addEventListener("click", (e) => {
    if (e.detail === 0) change(1);
  });

  render();
  renderDots(false);
  renderTitle();
  // The app opens on Home. Wait for the label font so the curved names are measured in Geist.
  showHome();
  document.fonts?.ready.then(refreshHome);

  // Offline copy for the installed app (sw.js). Service workers need http(s) on localhost or HTTPS, so this does
  // nothing via file:// or a plain-http LAN address. Also ask the browser not to clear our storage under pressure.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  navigator.storage?.persist?.().catch(() => {});
})();
