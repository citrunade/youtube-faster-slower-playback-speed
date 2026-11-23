// Isolated-world bridge: takes the plan (on/off, speed, picture delay) from the extension and
// applies it to the page, reports when an ad is playing (ads play at normal speed), and adds
// the in-player controls: a speed button in YouTube's control bar that opens the settings
// panel, and an always-visible − / + pill that changes the speed in steps of 0.25.
(() => {
  const STEP = 0.25, MIN = 0.5, MAX = 4;
  const picture = new FsPictureDelay();
  let plan = { on: false, rate: 1, keepPitch: false, engine: null, picture: false, sync: 0 };
  let ad = false;
  let tabId = null;
  let speed = 1.25; // the chosen speed

  const BUILD = 12; // must match the background's BUILD
  const setPageRate = (r, voice) => document.dispatchEvent(new CustomEvent('fasterslower:rate', { detail: voice ? `${r}|voice` : String(r) }));

  function apply() {
    pageRate();
    pictureDelay();
    ui.place();
    if (plan.engine || engine.chain) engine.sync().then(afterSync);
  }

  // The speed. Until the sound engine runs (it may be waiting for a first click on the page, or
  // still loading), the browser keeps the pitch itself, so nothing ever plays chipmunk-high.
  const pageRate = () => setPageRate(ad ? 1 : plan.rate, plan.keepPitch || !engine.chain);
  const afterSync = () => { pageRate(); pictureDelay(); };

  // The picture is held back by as much as the engine delays the sound (plus the fine-tune).
  const pictureDelay = () => picture.setDelay(plan.engine && plan.picture && engine.chain
    ? Math.max(0, engine.latency * 1000 + plan.sync) : null);

  const takePlan = (m) => {
    plan = { on: !!m.on, rate: m.rate, keepPitch: !!m.keepPitch, engine: m.engine || null, picture: !!m.picture, sync: Number(m.sync) || 0 };
  };

  // ---- Sound engine -----------------------------------------------------------------------
  // Runs here in the page: the page's videos are routed through it (no tab capture, so no click
  // needed in each tab). Once routed, a video can only be heard through this audio graph: when
  // the engine is turned off, it is passed straight through. Videos are only routed once the
  // engine is wanted, so with the extension off from the start YouTube's sound is never touched.
  const engine = {
    ctx: null, input: null, chain: null, latency: 0, mod: null, captured: new WeakSet(),
    busy: null, again: false, failed: false, waitingForClick: false, sleeping: false, sleepTimer: 0,

    want() { return plan.on && !!plan.engine && !this.failed; },
    settings() { return ad ? { ...plan.engine, speed: 1 } : plan.engine; },

    // One run at a time; a change during a run is picked up by one more run after it.
    async sync() {
      if (this.busy) { this.again = true; return this.busy; }
      this.busy = (async () => {
        do {
          this.again = false;
          try { await this.syncNow(); } catch (e) {
            this.failed = true;
            this.off();
            ui.toast(`Sound engine couldn't start (speed still applies): ${e?.message || e}`, 6000);
          }
        } while (this.again);
      })();
      try { await this.busy; } finally { this.busy = null; }
    },

    async syncNow() {
      if (!this.want()) { this.off(); return; }
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'playback' });
        this.input = this.ctx.createGain();
        this.input.connect(this.ctx.destination); // straight through until the engine is built
      }
      // Asleep (video paused a while): settings still apply, sound wakes up on play.
      if (this.ctx.state !== 'running' && !this.sleeping) {
        await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1000))]).catch(() => {});
        // The browser only lets sound start after a click or key press on the page. Until then
        // nothing is routed (a routed video would go silent).
        if (this.ctx.state !== 'running') { this.waitForClick(); return; }
      }
      if (!this.chain) {
        this.mod = this.mod || await import(chrome.runtime.getURL('audio-chain.js'));
        const chain = await this.mod.buildChain(this.ctx, this.input, this.settings());
        if (!this.want()) { chain.disconnect(); return; }
        try { this.input.disconnect(this.ctx.destination); } catch {}
        this.chain = chain;
        this.latency = chain.latency + (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
        sentPaused = null; // mute at once if the video is paused
      } else {
        this.latency = this.chain.apply(this.settings()) + (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
      }
      this.capture();
    },

    // Route every video on the page that isn't yet (YouTube adds new ones for Shorts and ads).
    capture() {
      if (!this.chain) return;
      for (const v of document.querySelectorAll('video')) {
        if (this.captured.has(v)) continue;
        try { this.ctx.createMediaElementSource(v).connect(this.input); this.captured.add(v); } catch {}
      }
    },

    // Paused for a while: put the audio work to sleep, so a paused or forgotten YouTube tab
    // costs nothing. Woken the moment the video plays again.
    pausedChanged(paused) {
      clearTimeout(this.sleepTimer);
      if (!this.ctx) return;
      if (paused) {
        this.sleepTimer = setTimeout(() => {
          if (this.ctx.state !== 'running') return;
          this.sleeping = true;
          this.ctx.suspend().catch(() => {});
        }, 10000);
      } else if (this.sleeping) {
        this.sleeping = false;
        this.ctx.resume().catch(() => {});
      }
    },

    off() {
      if (!this.chain) return;
      this.chain.disconnect();
      this.chain = null;
      try { this.input.connect(this.ctx.destination); } catch {}
    },

    waitForClick() {
      if (this.waitingForClick) return;
      this.waitingForClick = true;
      const go = () => {
        removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true);
        this.waitingForClick = false;
        this.ctx?.resume().catch(() => {});
        this.sync().then(afterSync);
      };
      addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.cmd === 'plan') {
      takePlan(msg);
      apply();
    }
    if (msg?.cmd === 'toast') ui.toast(msg.text);
    if (msg?.cmd === 'ping') reply({ ok: true });
    if (msg?.cmd === 'diag') {
      reply(engine.chain ? { ok: true, ...engine.chain.diag(), latency: engine.latency, ad, busy: !!engine.busy, wantSpeed: engine.settings()?.speed,
        picture: { delay: picture.delay, failed: picture.failed, attached: !!picture.video, gpu: !!picture.gl } } : { ok: false, error: engine.failed ? 'engine failed' : 'no audio chain', ctx: engine.ctx?.state });
    }
  });

  // The page script reports what kind of video this is; pass it on for the Auto sound setting.
  document.addEventListener('fasterslower:type', (e) => {
    try { chrome.runtime.sendMessage({ cmd: 'videoType', ...JSON.parse(e.detail) }).catch(() => {}); } catch {}
  });

  chrome.storage.local.get({ speed }).then((s) => { speed = s.speed; ui.render(); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.speed) { speed = c.speed.newValue; ui.render(); }
  });

  // ---- In-player controls ---------------------------------------------------------------
  const ui = {
    btn: null, pill: null, panel: null, toastEl: null, toastTimer: 0,

    // The player on screen. On Shorts the regular player stays in the page, hidden (zero size),
    // so pick the visible one; in the Shorts feed that is the Short currently in view.
    player() {
      if (!this.isShorts()) return document.querySelector('#movie_player.html5-video-player') || document.querySelector('.html5-video-player');
      let best = null, area = 0;
      for (const p of document.querySelectorAll('.html5-video-player')) {
        const r = p.getBoundingClientRect();
        const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
        const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
        if (w > 0 && h > 0 && w * h > area) { best = p; area = w * h; }
      }
      return best;
    },

    isShorts() { return location.pathname.startsWith('/shorts/'); },

    // Where our controls go. On Shorts, the box that holds both the video and the Shorts
    // buttons (play, sound, menu), so ours sit on top of them rather than underneath.
    host() {
      const p = this.player();
      if (!p || !this.isShorts()) return p;
      return p.closest('#player-container') || p;
    },

    // The speed the video is actually playing at: the chosen one only while something applies it.

    render() {
      const label = `${Number(speed).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;
      if (this.btn) {
        const mid = this.btn.querySelector('.fs-button');
        mid.querySelector('span').textContent = ad ? 'Ad' : label;
        mid.dataset.tip = 'Faster / Slower settings';
        this.btn.querySelector('.fs-bar-down').disabled = speed <= MIN;
        this.btn.querySelector('.fs-bar-up').disabled = speed >= MAX;
      }
      if (this.pill) {
        this.pill.querySelector('.fs-speed').textContent = ad ? 'Ad' : label;
        this.pill.querySelector('.fs-down').disabled = speed <= MIN;
        this.pill.querySelector('.fs-up').disabled = speed >= MAX;
      }
    },

    nudge(dir) {
      const next = Math.min(MAX, Math.max(MIN, Math.round((speed + dir * STEP) / STEP) * STEP));
      speed = next;
      this.render();
      chrome.storage.local.set({ speed: next });
    },

    toast(text, ms = 3500) {
      const p = this.host();
      if (!p) return;
      if (!this.toastEl) {
        this.toastEl = document.createElement('div');
        this.toastEl.style.cssText = 'position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:66;max-width:60%;'
          + 'padding:9px 14px;border-radius:18px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);color:#fff;'
          + 'font:500 13px/1.35 "YouTube Sans",Roboto,Arial,sans-serif;text-align:center;pointer-events:none;transition:opacity .25s;';
      }
      if (this.toastEl.parentElement !== p) p.appendChild(this.toastEl);
      this.toastEl.textContent = text;
      this.toastEl.style.opacity = '1';
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, ms);
    },

    makePill() {
      const pill = document.createElement('div');
      pill.className = 'fs-pill';
      const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${d}"/></svg>`;
      pill.innerHTML = `<button class="fs-down" type="button" aria-label="Slower (−0.25×)" title="Slower">${icon('M5 11h14v2H5z')}</button>`
        + '<button class="fs-speed" type="button" aria-label="Faster / Slower settings" title="Settings"></button>'
        + `<button class="fs-up" type="button" aria-label="Faster (+0.25×)" title="Faster">${icon('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z')}</button>`;
      // Keep clicks from reaching the player (which would pause/play).
      for (const ev of ['click', 'mousedown', 'dblclick', 'pointerdown']) pill.addEventListener(ev, (e) => e.stopPropagation());
      pill.querySelector('.fs-down').addEventListener('click', () => this.nudge(-1));
      pill.querySelector('.fs-up').addEventListener('click', () => this.nudge(1));
      pill.querySelector('.fs-speed').addEventListener('click', () => this.togglePanel());
      return pill;
    },

    // For YouTube's control bar: − / speed (opens the settings) / +, side by side.
    makeButton() {
      const bar = document.createElement('span');
      bar.className = 'fs-bar';
      // Plain − and + text: YouTube's control-bar styles shrink drawings inside its buttons.
      // Labels on hover like YouTube's own buttons (data-tip), not the browser's slow plain tooltip.
      bar.innerHTML = '<button class="ytp-button fs-bar-down" type="button" aria-label="Slower (−0.25×)" data-tip="Slower"><span>−</span></button>'
        + '<button class="ytp-button fs-button" type="button" aria-label="Faster / Slower settings"><span></span></button>'
        + '<button class="ytp-button fs-bar-up" type="button" aria-label="Faster (+0.25×)" data-tip="Faster"><span>+</span></button>';
      for (const b of bar.querySelectorAll('button')) {
        b.addEventListener('pointerenter', () => this.showTip(b));
        b.addEventListener('pointerleave', () => this.hideTip());
        b.addEventListener('click', () => this.hideTip());
      }
      for (const ev of ['click', 'mousedown', 'dblclick', 'pointerdown']) bar.addEventListener(ev, (e) => e.stopPropagation());
      bar.querySelector('.fs-bar-down').addEventListener('click', () => this.nudge(-1));
      bar.querySelector('.fs-bar-up').addEventListener('click', () => this.nudge(1));
      bar.querySelector('.fs-button').addEventListener('click', () => this.togglePanel());
      return bar;
    },

    // The hover label: centred above the button, like YouTube's own ("Settings", "Full screen").
    tip: null, tipFor: null,
    showTip(b) {
      const p = this.host();
      if (!p || !b.dataset.tip || this.panel?.style.display === 'block') return;
      if (!this.tip) { this.tip = document.createElement('div'); this.tip.className = 'fs-tip'; }
      if (this.tip.parentElement !== p) p.appendChild(this.tip);
      this.tip.textContent = b.dataset.tip;
      this.tipFor = b;
      const pr = p.getBoundingClientRect(), br = b.getBoundingClientRect();
      this.tip.style.bottom = `${pr.bottom - br.top + 22}px`; // same gap as YouTube's labels
      this.tip.style.display = 'block';
      // Centred on the button, kept inside the player.
      const w = this.tip.offsetWidth;
      const left = Math.max(8, Math.min(pr.width - w - 8, br.left - pr.left + br.width / 2 - w / 2));
      this.tip.style.left = `${left}px`;
    },
    hideTip() {
      this.tipFor = null;
      if (this.tip) this.tip.style.display = 'none';
    },

    togglePanel() {
      const p = this.host();
      if (!p || tabId == null) return;
      if (!this.panel) {
        const f = document.createElement('iframe');
        f.className = 'fs-panel';
        f.src = chrome.runtime.getURL(`popup.html?tab=${tabId}`);
        f.style.display = 'none';
        this.panel = f;
        const origin = new URL(chrome.runtime.getURL('')).origin;
        window.addEventListener('message', (e) => {
          if (e.origin !== origin) return;
          if (e.data?.fasterSlowerClose) { this.hidePanel(); return; }
          if (!e.data?.fasterSlowerHeight) return;
          this.panelHeight = e.data.fasterSlowerHeight;
          this.fitPanel();
        });
        document.addEventListener('click', (e) => {
          if (!this.btn?.contains(e.target) && !this.pill?.contains(e.target)) this.hidePanel();
        }, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hidePanel(); }, true);
      }
      if (this.panel.parentElement !== p) p.appendChild(this.panel);
      if (this.panel.style.display === 'block') { this.hidePanel(); return; }
      this.panel.classList.toggle('fs-from-bar', !!this.btn?.isConnected);
      this.panel.style.display = 'block';
      this.pill?.classList.add('fs-open');
      this.fitPanel();
    },

    fitPanel() {
      const p = this.host();
      if (!this.panel || !p) return;
      // Clear of the control bar (and of the pill), scrolling inside if the player is short.
      const room = p.clientHeight - 52 - 60;
      this.panel.style.height = `${Math.max(120, Math.min(this.panelHeight || 520, room))}px`;
    },

    hidePanel() {
      if (this.panel) this.panel.style.display = 'none';
      this.pill?.classList.remove('fs-open');
    },

    // Only while on: when off, nothing of ours is on the page.
    place() {
      if (!plan.on) {
        this.btn?.remove(); this.pill?.remove(); this.hidePanel();
        return;
      }
      const p = this.host();
      if (!p) return;
      const shorts = this.isShorts();
      // Videos: − speed + in YouTube's control bar. Shorts have no control bar (and a player
      // without one gets the same): a floating − speed + pill, whose middle opens the settings.
      const right = shorts ? null : p.querySelector('.ytp-right-controls');
      if (right) {
        this.pill?.remove();
        if (this.btn?.parentElement !== right) {
          this.btn = this.btn || this.makeButton();
          right.insertBefore(this.btn, right.firstChild);
        }
      } else {
        this.btn?.remove();
        // Follows the player as it moves (from a video to Shorts, from one Short to the next).
        this.pill = this.pill || this.makePill();
        if (this.pill.parentElement !== p) {
          p.appendChild(this.pill);
          if (this.panel && this.panel.parentElement !== p) this.hidePanel();
        }
        this.pill.classList.toggle('fs-shorts', shorts);
      }
      this.panel?.classList.toggle('fs-shorts', shorts);
      this.panel?.classList.toggle('fs-from-bar', !!right);
      if (this.toastEl && this.toastEl.parentElement !== p) this.toastEl.remove();
      this.render();
    },
  };

  const style = document.createElement('style');
  style.textContent = `
    .fs-button { position: relative; display: inline-flex !important; align-items: center; justify-content: center;
      width: auto !important; min-width: 48px; padding: 0 8px !important; vertical-align: top;
      font: 500 13px/1 "YouTube Sans", Roboto, Arial, sans-serif; color: #fff; letter-spacing: .2px; }
    .fs-button span { pointer-events: none; }
    .fs-bar { display: inline-flex; align-items: center; height: 100%; vertical-align: top; }
    .fs-bar .fs-bar-down, .fs-bar .fs-bar-up { display: inline-flex !important; align-items: center; justify-content: center;
      width: 40px !important; padding: 0 !important; color: #fff; font: 500 24px/1 Roboto, Arial, sans-serif; }
    /* YouTube's hover pill is a fixed 48px wide: fit it to each of our buttons instead, so it
       doesn't spill over their edges. */
    .fs-bar .ytp-button::before { width: 100% !important; }
    .fs-bar button:disabled::before { background-color: transparent !important; }
    .fs-tip { position: absolute; z-index: 71; display: none; width: max-content; max-width: 300px; pointer-events: none;
      padding: 5px 9px; border-radius: 8px; background: rgba(0,0,0,.3);
      color: #eee; font: 500 13px/15px "YouTube Noto", Roboto, Arial, sans-serif; text-align: center;
      text-shadow: 0 0 2px #000; }
    .ytp-autohide .fs-tip { display: none !important; }
    .fs-bar .fs-bar-down span, .fs-bar .fs-bar-up span { pointer-events: none; margin-top: -2px; }
    .fs-bar button:disabled { opacity: .35; cursor: default; }
    .fs-bar .fs-button { min-width: 48px; padding: 0 10px !important; font-variant-numeric: tabular-nums; }
    .fs-pill { position: absolute; top: 12px; right: 64px; z-index: 65; display: flex; align-items: center; gap: 0;
      height: 32px; padding: 0 2px; border-radius: 16px; background: rgba(0,0,0,.6);
      border: 1px solid rgba(255,255,255,.35); box-shadow: 0 1px 4px rgba(0,0,0,.35);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      color: #fff; font: 500 13px/1 "YouTube Sans", Roboto, Arial, sans-serif; user-select: none;
      transition: opacity .25s cubic-bezier(.4,0,.2,1), background .15s; }
    .fs-pill button { display: flex; align-items: center; justify-content: center; height: 28px; margin: 0; padding: 0;
      border: 0; border-radius: 14px; background: none; color: inherit; font: inherit; cursor: pointer; outline: none; }
    .fs-pill .fs-down, .fs-pill .fs-up { width: 28px; }
    .fs-pill .fs-speed { min-width: 38px; padding: 0 2px; font-variant-numeric: tabular-nums; }
    .fs-pill svg { display: block; width: 16px; height: 16px; fill: currentColor; }
    .fs-pill button:hover:not(:disabled) { background: rgba(255,255,255,.18); }
    .fs-pill button:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); }
    .fs-pill button:disabled { opacity: .3; cursor: default; }
    .ytp-autohide .fs-pill:not(:hover) { opacity: .5; }
    /* Shorts: bottom right corner, just above the progress bar, right of the title line.
       The panel opens upward from it. */
    /* Smaller than on videos, so it stays under the time that shows while dragging the bar
       (that time starts 34px above the bottom). */
    .fs-pill.fs-shorts { top: auto; bottom: 6px; right: 12px; height: 24px; border-radius: 12px; padding: 0 1px; font-size: 12px; }
    .fs-pill.fs-shorts button { height: 22px; border-radius: 11px; }
    .fs-pill.fs-shorts .fs-down, .fs-pill.fs-shorts .fs-up { width: 22px; }
    .fs-pill.fs-shorts .fs-speed { min-width: 32px; }
    .fs-pill.fs-shorts svg { width: 13px; height: 13px; }
    /* Like the Shorts' own buttons: gone while the mouse is off the Short, back when it's over it
       (and kept while the settings panel is open). */
    ytd-reel-video-renderer:not(:hover) .fs-pill.fs-shorts:not(.fs-open) { opacity: 0; }
    /* Opened from the control bar: just above it, at the right. */
    .fs-panel.fs-from-bar { top: auto; bottom: 60px; }
    .fs-panel.fs-shorts { top: auto; bottom: 42px; right: 12px; width: min(300px, calc(100% - 24px)); }
    .fs-panel { position: absolute; right: 12px; top: 52px; z-index: 70; width: 300px; border: 0; border-radius: 12px;
      background: rgba(28,28,28,.9); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 4px 32px rgba(0,0,0,.4); color-scheme: dark; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // YouTube marks the player with "ad-showing" while an ad plays; it also rebuilds the player
  // on navigation, so the controls are put back when they go missing.
  const check = () => {
    ui.place();
    engine.capture();
    const now = !!ui.player()?.classList.contains('ad-showing'); // the player on screen, not a hidden one
    if (now === ad) return;
    ad = now;
    if (plan.rate !== 1) apply();
    else ui.render();
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; check(); });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  // Pause / play: cut the sound at once, so it stops with the click instead of ~0.15 s later
  // (the sound still in the engine), and let the engine sleep while paused. Checked again every
  // second in case an event is missed.
  let sentPaused = null;
  const reportPaused = () => {
    const v = ui.player()?.querySelector('video');
    const paused = plan.on && v ? v.paused : false;
    if (paused === sentPaused) return;
    sentPaused = paused;
    engine.chain?.mute(paused);
    engine.pausedChanged(paused);
  };
  for (const ev of ['pause', 'play', 'playing']) document.addEventListener(ev, reportPaused, true);
  setInterval(reportPaused, 1000);

  // The video running dry for a moment (a short stop): keep a note of the last few, with whether
  // the tab was in the background and how much was loaded ahead, so the cause can be traced.
  document.addEventListener('waiting', (e) => {
    const v = e.target;
    if (!plan.on || v !== ui.player()?.querySelector('video') || v.seeking) return;
    let ahead = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
    }
    const note = { at: Date.now(), hidden: document.hidden, rate: v.playbackRate, ahead: Math.round(ahead * 10) / 10, engine: !!engine.chain };
    chrome.storage.local.get({ stalls: [] })
      .then(({ stalls }) => chrome.storage.local.set({ stalls: [note, ...stalls].slice(0, 20) }))
      .catch(() => {});
  }, true);

  // "Keep settings for next videos" off: every video starts at normal speed, original pitch and
  // no effects: a different video, a video opened in a new tab, a reload, after a restart. The
  // sound method, picture sync and fine-tune are setup, not per video, so they stay.
  // Turning the extension on in the middle of a video doesn't count as a new video.
  const RESET = { speed: 1, pitch: 0, tape: false, bass: 0, tail: 0, reverb: 0 };
  const videoIdOf = (u) => {
    try {
      const url = new URL(u);
      return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/)?.[1] || null;
    } catch { return null; }
  };
  let planKnown = false; // the background has told this page whether it's on
  let pageLoad = true; // the first video seen since this page loaded (not since turning on)
  let seenVideo = null;
  const checkVideo = async () => {
    if (!planKnown) return;
    if (!plan.on) { seenVideo = null; pageLoad = false; return; }
    const id = videoIdOf(location.href);
    if (!id || id === seenVideo) return;
    const turnedOnHere = seenVideo == null && !pageLoad;
    seenVideo = id;
    pageLoad = false;
    if (turnedOnHere) return;
    const s = await chrome.storage.local.get({ keep: true, ...RESET });
    if (s.keep !== false) return;
    if (Object.keys(RESET).every((k) => s[k] === RESET[k])) return; // already fresh
    await chrome.storage.local.set(RESET);
    ui.toast('New video: speed and effects reset (Keep settings is off).');
  };
  setInterval(checkVideo, 500);

  // On (re)load, ask whether this tab is the one being processed (and learn our tab id).
  (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await chrome.runtime.sendMessage({ cmd: 'hello' });
        if (r && 'rate' in r) {
          if (r.tabId != null) tabId = r.tabId;
          if (r.build !== BUILD) {
            setTimeout(() => ui.toast("Faster / Slower was updated: reload it on the browser's extensions page."), 3000);
          }
          takePlan(r);
          apply();
          planKnown = true;
          return;
        }
      } catch {}
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  })();
})();
