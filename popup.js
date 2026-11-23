// Settings panel, shown inside the YouTube player while the extension is on (an iframe opened
// from the player's speed button). On/off itself is the toolbar icon or Alt+Shift+S.
const SLIDERS = { speed: 1.25, pitch: 0, sync: 0, bass: 0, tail: 0, reverb: 0 };
const DEFAULTS = { ...SLIDERS, tape: false, picture: true, sound: 'auto', keep: true };
const SOUND_NAMES = { music: 'Music', voice: 'Voice' };
const SOUND_HINTS = {
  music: 'Smoothest for songs. The picture is held back to match.',
  voice: 'Clearest for talking; can sound choppy on music.',
};
const soundOf = (s) => (s.sound === 'music' || s.sound === 'voice' ? s.sound : 'auto');
const $ = (id) => document.getElementById(id);
const tabId = Number(new URLSearchParams(location.search).get('tab')) || null;
let detected = null; // what Auto found for this tab: { type, why }

const fmt = {
  speed: (v) => `${Number(v).toFixed(2)}×`,
  pitch: (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? '0 st' : `${r > 0 ? '+' : ''}${r.toFixed(1)} st`; },
  sync: (v) => (Number(v) === 0 ? '0 ms' : `${v > 0 ? '+' : ''}${v} ms`),
  bass: (v) => `+${Number(v).toFixed(1)} dB`,
  reverb: (v) => `${Math.round(v * 100)}%`,
  tail: (v) => `${Math.round(v * 100)}%`,
};

// Pitch slider shows how it sounds compared with the original: 0 = original pitch.
// In tape mode the speed itself moves the pitch: the (greyed-out) slider just shows it.
const shownPitch = (s) => (s.tape ? 12 * Math.log2(s.speed) : Number(s.pitch || 0));

// Slider position, and the filled (red) part of its track.
function setSlider(el, v) {
  el.value = v;
  const min = Number(el.min), max = Number(el.max);
  el.style.setProperty('--p', `${((Number(el.value) - min) / (max - min)) * 100}%`);
}

function render(s) {
  $('tape').checked = !!s.tape;
  $('pitch').disabled = $('pitchReset').disabled = !!s.tape;
  $('pitchGroup').classList.toggle('locked', !!s.tape);
  $('pitchHint').textContent = s.tape ? 'Pitch follows speed, like a record.' : '';
  $('keep').checked = s.keep !== false;
  $('keepHint').textContent = s.keep !== false ? '' : 'Off: every video starts at 1×, original pitch, no effects (also in new tabs and after reloading).';
  document.querySelectorAll('.sound button').forEach((b) => {
    const on = b.dataset.sound === soundOf(s);
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  const auto = soundOf(s) === 'auto';
  const used = auto ? (detected?.type === 'voice' ? 'voice' : 'music') : s.sound;
  $('soundHint').textContent = (auto
    ? (detected ? `Auto: ${SOUND_NAMES[used]} (from the video's ${detected.why === 'title' ? 'title' : `category, ${detected.why}`}). ` : 'Auto: Music until the video is recognised. ')
    : '') + (s.tape ? 'Tape mode always uses the Music method.' : SOUND_HINTS[used]);
  $('picture').checked = !!s.picture;
  $('sync').disabled = !s.picture;
  for (const k of Object.keys(SLIDERS)) {
    const v = k === 'pitch' ? shownPitch(s) : s[k];
    setSlider($(k), v);
    $(k + 'Out').textContent = fmt[k](v);
  }
  document.querySelectorAll('.presets button[data-speed]').forEach((b) =>
    b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - s.speed) < 0.001));
}

let current = { ...DEFAULTS };
async function save(patch) {
  current = { ...current, ...patch };
  render(current);
  await chrome.storage.local.set(patch);
}

for (const k of Object.keys(SLIDERS)) {
  $(k).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    save({ [k]: k === 'pitch' ? Math.round(v * 100) / 100 : v });
  });
}
$('tape').addEventListener('change', (e) => save({ tape: e.target.checked }));
$('picture').addEventListener('change', (e) => save({ picture: e.target.checked }));
$('keep').addEventListener('change', (e) => save({ keep: e.target.checked }));
$('pitchReset').addEventListener('click', () => save({ pitch: 0 }));
document.querySelectorAll('.presets button[data-speed]').forEach((b) =>
  b.addEventListener('click', () => save({ speed: Number(b.dataset.speed) })));
document.querySelectorAll('.sound button').forEach((b) =>
  b.addEventListener('click', () => save({ sound: b.dataset.sound })));

// The panel is an iframe in the player: tell the page how tall to make it, and close on Escape.
document.body.classList.add('embedded');
new ResizeObserver(() => parent.postMessage({ fasterSlowerHeight: document.body.scrollHeight + 4 }, '*')).observe(document.body);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ fasterSlowerClose: true }, '*'); });

// What Auto recognised for this tab's video.
async function refreshStatus() {
  const state = await chrome.runtime.sendMessage({ cmd: 'status', tabId }).catch(() => null);
  detected = state?.detected || null;
  render(current);
}

(async () => {
  current = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  render(current);
  await refreshStatus();
})();

// Settings changed elsewhere (the − / + pill) or the video type was recognised: follow along.
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local') {
    for (const k of Object.keys(DEFAULTS)) if (c[k]) current[k] = c[k].newValue;
    render(current);
  }
  if (area === 'session' && c[`detected_${tabId}`]) { detected = c[`detected_${tabId}`].newValue || null; render(current); }
});
