// Picture delay: the processed sound comes out ~0.15 s late, so the picture is held back by
// the same amount. The real video keeps playing underneath, invisible; every new frame is
// copied into a small ring of canvases, and a canvas on top shows the frame from `delay` ms ago.
// Frames are copied (not kept as decoder frames), so the video decoder is never starved.
// Firefox: copying a video frame onto a plain canvas costs ~12 ms of the page's time per frame
// (enough to make the picture hitch), so there the copies are GPU textures (WebGL), ~0 ms.
// eslint-disable-next-line no-unused-vars
class FsPictureDelay {
  constructor() {
    this.delay = null; // ms; null = off
    this.cur = null; // delay in use now: eases toward `delay` so a change never freezes the picture
    this.lastTick = 0;
    this.video = null;
    this.view = null; // the canvas shown on top
    this.ring = []; // { canvas, at } copies of recent frames, oldest first
    this.free = [];
    this.shown = null;
    this.raf = 0;
    this.failed = false;
    this.tick = this.tick.bind(this);
    this.flush = this.flush.bind(this);
    this.freeze = this.freeze.bind(this);
    const style = document.createElement('style');
    style.textContent = 'video.fs-delayed{opacity:0!important}';
    (document.head || document.documentElement).appendChild(style);
    // On another tab nothing is seen: stop copying frames altogether (copying from a hidden
    // video keeps Chrome decoding pictures it would otherwise skip, and piles up frame copies),
    // and start again fresh when the tab is back.
    document.addEventListener('visibilitychange', () => {
      if (this.delay == null) return;
      if (document.hidden) { this.detach(false); return; }
      this.track();
      // Ease the delay back in from none, so the picture doesn't jump back 0.15 s on return.
      if (this.video) this.cur = 0;
    });
  }

  // GPU copies: Firefox only (Chrome's plain canvas copies are cheap and well tried).
  static gpu = /Firefox\//.test(navigator.userAgent);

  setDelay(ms) {
    this.delay = ms == null || this.failed ? null : Math.max(0, ms);
    if (this.delay == null) this.detach();
    else if (!document.hidden) this.track();
  }

  // The main player video (the largest one playing), or null.
  findVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area && v.readyState > 0) { best = v; area = r.width * r.height; }
    }
    return best;
  }

  track() {
    const v = this.findVideo();
    if (v && v !== this.video) this.attach(v);
    if (!this.watch) {
      // YouTube swaps or re-parents the video on navigation: re-check now and then.
      this.watch = setInterval(() => { if (this.delay != null && !document.hidden) { const n = this.findVideo(); if (n && n !== this.video) this.attach(n); } }, 1000);
    }
  }

  attach(video) {
    this.detach(false);
    this.video = video;
    this.view = document.createElement('canvas');
    this.view.className = 'fs-picture';
    this.gl = null;
    if (FsPictureDelay.gpu) {
      try { this.gl = this.view.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false }); } catch {}
      // GPU gone (driver reset, too many pages using it): plain canvas copies from then on.
      this.view.addEventListener('webglcontextlost', () => { FsPictureDelay.gpu = false; const v = this.video; this.detach(false); if (v) this.attach(v); });
    }
    this.view.style.cssText = 'position:absolute;pointer-events:none;';
    video.after(this.view);
    video.addEventListener('seeking', this.flush);
    video.addEventListener('emptied', this.flush);
    video.addEventListener('pause', this.freeze);
    // One frame-copy loop per attach: a loop left from before (same video, tab hidden and back
    // quickly) stops at its next frame instead of running alongside.
    const gen = this.gen = (this.gen || 0) + 1;
    const cb = (now) => { if (gen === this.gen && this.onFrame(now)) video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
    this.raf = requestAnimationFrame(this.tick);
  }

  detach(stopWatching = true) {
    if (stopWatching && this.watch) { clearInterval(this.watch); this.watch = null; }
    this.gen = (this.gen || 0) + 1;
    if (this.video) {
      this.video.classList.remove('fs-delayed');
      this.video.removeEventListener('seeking', this.flush);
      this.video.removeEventListener('emptied', this.flush);
      this.video.removeEventListener('pause', this.freeze);
    }
    if (this.gl) { try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {} this.gl = null; }
    this.view?.remove();
    cancelAnimationFrame(this.raf);
    this.cur = null;
    this.video = this.view = this.shown = this.stage = null;
    this.ring = []; this.free = [];
  }

  // After a seek the held frames belong to the old position: show the new one straight away.
  flush() {
    this.free.push(...this.ring);
    this.ring = [];
  }

  // Paused: show the frame it stopped on right away instead of playing out the held frames
  // (the sound is cut at the same moment).
  freeze() {
    const last = this.ring[this.ring.length - 1];
    if (!last || !this.view) return;
    try { this.show(last); } catch { return; }
    if (this.shown && this.shown !== last) this.free.push(this.shown);
    this.free.push(...this.ring.slice(0, -1));
    this.ring = [];
    this.shown = last;
    this.video.classList.add('fs-delayed');
  }

  // A free copy slot of this size: a canvas, or (GPU) a texture with a framebuffer to blit from.
  slot(w, h) {
    let slot = this.free.pop();
    if (slot && (slot.w !== w || slot.h !== h)) { this.drop(slot); slot = null; }
    if (slot) return slot;
    const gl = this.gl;
    if (!gl) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return { canvas, w, h }; }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  drop(slot) {
    if (this.gl && slot.tex) { this.gl.deleteFramebuffer(slot.fb); this.gl.deleteTexture(slot.tex); }
  }

  copy(v, slot, w, h) {
    const gl = this.gl;
    if (!gl) { slot.canvas.getContext('2d').drawImage(v, 0, 0, w, h); return; }
    // The frame goes up at its own size into a staging texture, then is scaled into the slot.
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) throw new Error('no frame');
    if (!this.stage) {
      this.stage = { tex: gl.createTexture(), fb: gl.createFramebuffer() };
      gl.bindTexture(gl.TEXTURE_2D, this.stage.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stage.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.stage.fb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.stage.tex, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, slot.fb);
    // Flipped on the way (textures are stored upside down relative to the screen).
    gl.blitFramebuffer(0, 0, vw, vh, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR);
  }

  show(slot) {
    const gl = this.gl;
    if (!gl) { this.view.getContext('2d').drawImage(slot.canvas, 0, 0); return; }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, slot.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, slot.w, slot.h, 0, 0, this.view.width, this.view.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
  }

  onFrame(now) {
    const v = this.video;
    if (!v || this.delay == null) return false;
    try {
      const w = this.view.width, h = this.view.height;
      if (w && h) {
        const slot = this.slot(w, h);
        this.copy(v, slot, w, h);
        slot.at = now;
        this.ring.push(slot);
        // Never hold more than ~1 s of frames.
        while (this.ring.length > 90) this.free.push(this.ring.shift());
      }
    } catch (e) {
      // Protected video can't be copied: give up and show the real video.
      this.failed = true;
      this.setDelay(null);
      return false;
    }
    return true; // keep going
  }

  tick() {
    const v = this.video, view = this.view;
    if (!v || !view) return;
    this.raf = requestAnimationFrame(this.tick);
    // Sit exactly where YouTube put the video, at screen resolution capped at 1280 wide (copying
    // every frame at full HD was heavy enough to make playback hitch on busier computers).
    if (view.parentElement !== v.parentElement) v.after(view);
    const cs = v.style;
    if (view.style.left !== cs.left) view.style.left = cs.left;
    if (view.style.top !== cs.top) view.style.top = cs.top;
    const cw = v.clientWidth, ch = v.clientHeight;
    if (view.style.width !== `${cw}px`) { view.style.width = `${cw}px`; view.style.height = `${ch}px`; }
    const scale = Math.min(devicePixelRatio || 1, 1280 / Math.max(1, cw));
    const w = Math.round(cw * scale), h = Math.round(ch * scale);
    if (view.width !== w || view.height !== h) { view.width = w; view.height = h; this.flush(); }

    // A new delay (e.g. switching between the Music and Voice methods) is eased in at up to
    // 10 % speed difference instead of jumping: a jump to a longer delay held the picture still
    // for that long; a jump to a shorter one skipped frames.
    const now = performance.now();
    if (this.cur == null) this.cur = this.delay;
    const step = Math.min(100, now - (this.lastTick || now)) * 0.1;
    this.lastTick = now;
    this.cur += Math.max(-step, Math.min(step, this.delay - this.cur));
    const due = now - this.cur;
    // Drop frames that a newer due frame replaces.
    while (this.ring.length > 1 && this.ring[1].at <= due) this.free.push(this.ring.shift());
    const head = this.ring[0];
    if (head && head.at <= due) {
      if (head !== this.shown) {
        this.show(head);
        if (this.shown && !this.ring.includes(this.shown)) this.free.push(this.shown);
        this.shown = head;
        this.ring.shift();
        // Only hide the real video once there is a delayed frame to show instead.
        v.classList.add('fs-delayed');
      }
    }
  }
}
