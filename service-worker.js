// Background: keeps every YouTube tab in step with the settings. The sound engine itself runs
// inside each YouTube page (content.js): the page's videos are routed through it, so there is
// no tab capture and no click needed in each tab. Same file for Chrome and Firefox.

// enabled: the on/off switch (toolbar icon). One setting for the whole browser; it stays as set
// across refreshes, tabs and restarts. On from the start (after installing).
const DEFAULTS = { enabled: true, speed: 1.25, pitch: 0, tape: false, bass: 0, reverb: 0, tail: 0, picture: true, sync: 0, sound: 'auto', keep: true };
// keep off: these go back to normal whenever a different video starts (see content.js).
const SOUNDS = ['music', 'voice'];
// Settings the pages follow; a change to any of them is sent to every YouTube tab.
const PAGE_KEYS = ['speed', 'pitch', 'tape', 'bass', 'reverb', 'tail', 'sound', 'picture', 'sync'];
// Bumped whenever this file changes; the page compares it to spot an outdated background copy.
const BUILD = 12;

const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) });

// What the page detected for a tab (Auto sound setting): { type, why, videoId }.
const detectedKey = (tabId) => `detected_${tabId}`;
async function detectedFor(tabId) {
  if (tabId == null) return null;
  return (await chrome.storage.session.get(detectedKey(tabId)))[detectedKey(tabId)] || null;
}

// Which method to use: the chosen one, or for Auto voice only for clearly spoken videos.
async function profileFor(tabId, s) {
  if (SOUNDS.includes(s.sound)) return s.sound;
  return (await detectedFor(tabId))?.type === 'voice' ? 'voice' : 'music';
}

// What a page should do. Off: nothing. On: the speed, and the settings for its sound engine;
// the page works out the picture delay from its own engine's latency.
// Voice: the page keeps the browser's own pitch-keeping speed change on (built for speech).
async function pagePlan(forTab) {
  const s = await getSettings();
  if (!s.enabled) return { on: false, rate: 1 };
  const profile = await profileFor(forTab, s);
  return { on: true, rate: s.speed, keepPitch: profile === 'voice' && !s.tape, engine: { ...s, profile }, picture: !!s.picture, sync: Number(s.sync || 0) };
}

async function sendPlan(tabId) {
  if (tabId == null) return;
  const plan = await pagePlan(tabId);
  chrome.tabs.sendMessage(tabId, { cmd: 'plan', ...plan }).catch(() => {});
}

const YT_URLS = ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://music.youtube.com/*'];
async function sendPlanAll() {
  const tabs = await chrome.tabs.query({ url: YT_URLS }).catch(() => []);
  await Promise.all(tabs.map((t) => sendPlan(t.id)));
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg?.cmd) {
      case 'toggle': await toggle(); return { ok: true };
      case 'status': {
        const s = await getSettings();
        return { enabled: s.enabled, detected: await detectedFor(msg.tabId), profile: await profileFor(msg.tabId, s), build: BUILD, shortcut: await shortcutKeys() };
      }
      // The page recognised what kind of video this is (Auto sound setting).
      case 'videoType': {
        const id = sender.tab?.id;
        if (id == null || !['music', 'mixed', 'voice'].includes(msg.type)) return { ok: true };
        await chrome.storage.session.set({ [detectedKey(id)]: { type: msg.type, why: msg.why, videoId: msg.videoId } });
        if ((await getSettings()).sound === 'auto') await sendPlan(id);
        return { ok: true };
      }
      // A YouTube page (re)loaded or navigated: tell it what to do.
      case 'hello': reloadIfFilesChanged(); return { ...(await pagePlan(sender.tab?.id)), tabId: sender.tab?.id, build: BUILD };
      // The sound engine's state in a tab (levels, settings in use), for checking it works.
      case 'diag': return msg.tabId != null ? chrome.tabs.sendMessage(msg.tabId, { cmd: 'diag' }) : { ok: false, error: 'tabId needed' };
    }
  })().then(
    (r) => reply(r ?? { ok: true }),
    (e) => reply({ ok: false, error: String(e?.message || e) }),
  );
  return true;
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) updateBadge();
  if (changes.enabled || PAGE_KEYS.some((k) => changes[k])) await sendPlanAll();
});

// On/off: the toolbar icon or the keyboard shortcut (Alt+Shift+S by default). Every YouTube tab
// follows it. Each switch leaves a note (lastClick), so a click that "does nothing" can be traced.
async function toggle() {
  const { enabled } = await getSettings();
  await chrome.storage.local.set({ enabled: !enabled, lastClick: { at: Date.now(), step: enabled ? 'turned off' : 'turned on' } });
}

// Loaded from a folder (unpacked): when the folder holds a newer version, reload, so every
// browser profile using the folder picks it up (a second profile, like the app window, otherwise
// keeps running its old copy). Checked when this script starts, when a page loads and on clicks.
async function reloadIfFilesChanged() {
  try {
    if ((await chrome.management.getSelf()).installType !== 'development') return false;
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    if (!disk.version || disk.version === chrome.runtime.getManifest().version) return false;
    // One try per new version every 10 min, so a reload that doesn't take can't loop.
    const { reloadTry } = await chrome.storage.local.get('reloadTry');
    if (reloadTry?.version === disk.version && Date.now() - reloadTry.at < 10 * 60e3) return false;
    await chrome.storage.local.set({ reloadTry: { version: disk.version, at: Date.now() } });
    chrome.runtime.reload();
    return true;
  } catch {}
  return false;
}
reloadIfFilesChanged();

// Note when this background script last loaded (to tell "never ran" from "ran and failed").
chrome.storage.local.set({ backgroundLoadedAt: Date.now(), backgroundBuild: BUILD }).catch(() => {});
chrome.action.onClicked.addListener(async () => {
  // Firefox may install without access to YouTube until the user allows it; a click on the icon
  // is the moment it may be asked for (before anything is awaited). Chrome: already granted, so
  // this returns at once without asking.
  chrome.permissions.request({ origins: YT_URLS }).catch(() => {});
  if (!(await reloadIfFilesChanged())) toggle();
});
chrome.commands.onCommand.addListener((command) => { if (command === 'toggle') toggle(); });

// The keys of the on/off shortcut as the browser shows them ("Alt+Shift+S"), '' when none is set.
async function shortcutKeys() {
  try { return (await chrome.commands.getAll()).find((c) => c.name === 'toggle')?.shortcut || ''; } catch { return ''; }
}

// Toolbar badge: OFF while switched off, nothing while on.
async function updateBadge() {
  const { enabled } = await getSettings();
  chrome.action.setBadgeBackgroundColor({ color: '#5f5f5f' }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ color: '#fff' })?.catch?.(() => {});
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' }).catch(() => {});
}
updateBadge();

chrome.tabs.onRemoved.addListener((closedId) => { chrome.storage.session.remove(detectedKey(closedId)); });
