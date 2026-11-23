// Runs inside the YouTube page itself (MAIN world). Forces the player's video element(s) to
// the chosen speed with pitch keeping OFF (plain resample, smooth; the extension corrects
// the pitch afterwards). YouTube's own rate writes are remembered and restored when we stop.
(() => {
  if (window.__fasterSlowerRate) return;
  window.__fasterSlowerRate = true;

  const proto = HTMLMediaElement.prototype;
  const rateDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  const pitchDesc = Object.getOwnPropertyDescriptor(proto, 'preservesPitch');
  const origPlay = proto.play;
  const els = new Set();
  const pageRate = new WeakMap();
  let forced = 1; // 1 = not forcing
  // Voice mode: keep the browser's own pitch keeping on (built for speech) while forcing the rate.
  let keepPitch = false;

  const nativeRate = (el) => rateDesc.get.call(el);

  function applyTo(el) {
    const on = forced !== 1;
    const target = on ? forced : (pageRate.get(el) ?? 1);
    try {
      if (pitchDesc) pitchDesc.set.call(el, !on || keepPitch);
      if (nativeRate(el) !== target) rateDesc.set.call(el, target);
    } catch {}
  }

  function track(el) {
    if (!els.has(el)) {
      els.add(el);
      // A new video resets the rate to defaultPlaybackRate: put ours back.
      el.addEventListener('ratechange', () => {
        if (forced !== 1 && nativeRate(el) !== forced) applyTo(el);
      });
      el.addEventListener('loadstart', () => applyTo(el));
    }
    applyTo(el);
  }

  Object.defineProperty(proto, 'playbackRate', {
    configurable: true,
    enumerable: rateDesc.enumerable,
    // Report the real rate so the page's own clock and progress bar stay right.
    get() { return nativeRate(this); },
    // YouTube reads the rate back and writes it again (new video, ads). That echo of our own
    // forced rate is not the viewer's choice: don't remember it, or turning off would keep it.
    set(v) {
      if (!(forced !== 1 && Number(v) === forced)) pageRate.set(this, v);
      track(this);
    },
  });

  proto.play = function (...args) {
    track(this);
    return origPlay.apply(this, args);
  };

  // ---- What kind of video is this? (for the "Auto" sound setting) ----------------------
  // From YouTube's own data: the video's category, title and tags. Music gets the smooth
  // tuning, talk gets the crisp one, everything else the in-between one.
  const MUSIC_RE = /official (music )?video|official audio|\blyrics?\b|\bremix\b|\bft\.|\bfeat\.|\bcover\b|instrumental|\bost\b|soundtrack|\bmv\b|nightcore|slowed|sped up|\balbum\b|\bplaylist\b|\bmix\b|\bbeats?\b|\blofi\b|lo-fi|\bsong\b/i;
  const VOICE_RE = /podcast|interview|lecture|\btalk\b|explained|tutorial|how to|\breview\b|reaction|\bvlog\b|\bnews\b|debate|documentary|\bcourse\b|lesson|speech|sermon|audiobook|commentary|\bq&a\b|panel/i;
  const VOICE_CATS = new Set(['Education', 'Science & Technology', 'News & Politics', 'Howto & Style', 'People & Blogs', 'Nonprofits & Activism']);

  function detectType() {
    if (location.hostname === 'music.youtube.com') return { type: 'music', why: 'YouTube Music' };
    let pr = null;
    try { pr = document.querySelector('#movie_player')?.getPlayerResponse?.() || null; } catch {}
    pr = pr || window.ytInitialPlayerResponse;
    const vd = pr?.videoDetails;
    if (!vd?.videoId) return null;
    const cat = pr?.microformat?.playerMicroformatRenderer?.category || '';
    const text = `${vd.title || ''} ${(vd.keywords || []).join(' ')}`;
    const music = cat === 'Music' || MUSIC_RE.test(vd.title || '');
    const voice = VOICE_CATS.has(cat) || VOICE_RE.test(text);
    const type = music && voice ? 'mixed' : music ? 'music' : voice ? 'voice' : 'mixed';
    return { type, why: cat || 'title', videoId: vd.videoId };
  }

  let lastKey = '';
  setInterval(() => {
    if (!/\/(watch|shorts|live)|music\.youtube/.test(location.href)) return;
    const t = detectType();
    if (!t) return;
    const key = `${t.videoId}|${t.type}`;
    if (key === lastKey) return;
    lastKey = key;
    // Strings cross from the page's world to the extension's; objects don't.
    document.dispatchEvent(new CustomEvent('fasterslower:type', { detail: JSON.stringify(t) }));
  }, 1000);

  // detail: "<rate>" (music: plain resample, the extension corrects the pitch) or
  // "<rate>|voice" (the browser keeps the pitch itself).
  document.addEventListener('fasterslower:rate', (e) => {
    const [rs, mode] = String(e.detail).split('|');
    keepPitch = mode === 'voice';
    const r = Number(rs);
    forced = r > 0 ? r : 1;
    document.querySelectorAll('audio, video').forEach(track);
    els.forEach(applyTo);
  });
})();
