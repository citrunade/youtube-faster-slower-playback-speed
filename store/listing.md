# Chrome Web Store listing: YouTube Faster / Slower Control

Copy these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).

## Store listing tab

**Name** (from the manifest): YouTube Faster / Slower Control

**Summary** (from the manifest, 132 characters max):
Speed up or slow down YouTube at the original pitch, smooth enough for music, with the picture in sync. Not affiliated with YouTube.

**Category**: Entertainment

**Language**: English

**Description**:

Watch YouTube faster or slower without the warbling, choppy sound of the built-in speed setting, and without the chipmunk voice. Smooth enough for music.

Music sound: smooth at any speed
YouTube's own speed setting chops the sound into pieces to keep the pitch, which is fine for talking but turns songs warbly and choppy. Faster / Slower speeds the video up the smooth way (like a record spun faster), then a music-grade pitch shifter brings the pitch back to the original. Nothing is chopped up, so songs, voices and drums stay clean, even at 2× or 0.5×. That processing takes about 0.15 s, so the picture is held back by the same amount and lips stay in sync.

Features
• Music sound method: smoothest for songs, at the original pitch
• Voice sound method: clearest for talking, or Auto: picks Music or Voice for each video
• Speed from 0.5× to 4×, with one-click presets
• Works on Shorts too
• Original pitch at any speed, or shift the pitch up or down yourself
• Tape mode: pitch follows speed for the classic "slowed + reverb" or nightcore sound
• Always-visible − / + speed buttons in the player (0.25 steps), also in fullscreen
• All settings open right inside the player
• Works in every YouTube tab right away: no extra clicks per tab
• One click on the toolbar icon (or Alt+Shift+S) turns it on or off; nothing shows on YouTube while it's off
• Picture kept in sync with the sound, with a fine-tune slider
• Bass boost, reverb and drum tail (drum hits ring out longer)
• Keep your settings for every video, or start each new video fresh at normal speed: your choice
• Ads play at normal speed
• Works in theater mode, fullscreen and when the next video starts

How to use
1. Open a YouTube video. It's on from the start, in every YouTube tab.
2. In the player's control bar, next to the subtitles button, press − or + to change the speed by 0.25.
3. Click the speed between them for all settings. For songs, pick Music under Sound (Auto picks it for music videos). Changes apply live.
4. On Shorts, the same − speed + sits small in the bottom right corner of the Short.
5. Click the extension icon (or press Alt+Shift+S) to turn it off or on again.

Privacy: everything stays on your computer. No accounts, no tracking, no data sent anywhere.

Not affiliated with, endorsed by or sponsored by YouTube or Google. YouTube is a trademark of Google LLC.

**Icon**: icons/128.png

**Screenshots** (1280×800), in this order: store/screenshot-1.png (speed, smooth Music sound), store/screenshot-2.png (in the player). Remake them with `make-screenshots.ps1`.

**Promo tiles**: store/promo-small.png (440×280, small promo tile) and store/promo-marquee.png (1400×560, marquee). Remake them with `store/make-promo.ps1` in the folder above.

## Privacy practices tab

**Single purpose**:
Change the playback speed and pitch of YouTube videos with smooth sound, keeping the picture in sync, and add audio effects (bass, reverb, drum tail).

**Permission justifications**:

- storage: Saves the user's settings (speed, pitch, picture sync, effects).
- Host permissions (www.youtube.com, m.youtube.com, music.youtube.com): Sets the playback speed on the video, passes the video's sound through the extension's pitch correction and effects inside the page (processed live, never recorded or sent anywhere), shows the video picture slightly delayed so it stays in sync with the processed sound, and adds speed buttons and the settings panel inside the player. The extension runs on no other site.

**Remote code**: No, I am not using remote code. (The pitch shifter is bundled WebAssembly inside the package.)

**Data usage**: leave every data type unticked. Nothing is collected: settings stay on the user's device and are never sent anywhere.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**: publish store/privacy-policy.md somewhere public (for example a GitHub Gist or GitHub Pages) and paste its link. Optional: the extension collects no data, so leave this empty unless a reviewer asks for one.

## Package

Run `powershell -ExecutionPolicy Bypass -File build-store.ps1` in this folder and upload the zip it creates in `dist/`.

## Firefox (addons.mozilla.org)

Same name, summary and description. Category: Photos, Music & Videos. Upload the zip from `build-firefox.ps1` (in `dist/`, name ending in `-firefox-<version>.zip`). When asked whether the add-on contains machine-generated code, answer yes: `lib/SignalsmithStretch.mjs` is the compiled Signalsmith Stretch library (MIT licence, https://github.com/Signalsmith-Audio/signalsmith-stretch); point the reviewer to its public source and say which release it is. Everything else is hand-written and unminified.
