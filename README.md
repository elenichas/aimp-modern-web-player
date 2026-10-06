# AIMP Modern · Web Edition

A working React + TypeScript music player inspired by the supplied silver-and-blue AIMP Modern desktop skin. Independent and unofficial; no affiliation with AIMP or Winamp.

## Live app

[Open the private player](https://aimp-modern-web-player.eleni-133.chatgpt.site). Access is restricted to the owner.

## Run locally

Requires Node.js 22.12+ (or Node.js 24+). The current test toolchain requires a supported modern Node.js release.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite (normally `http://localhost:5173`).

```sh
npm test          # Audio graph, demo WAV and playlist utilities
npm run typecheck # Strict TypeScript
npm run build    # Production build into dist/
npm run preview  # Serve production build
```

The app builds to static files and does not require a backend. Relative asset paths allow hosting in a subdirectory. Serve `dist/` over HTTP(S); opening index.html directly as a file is not supported.

## What works

- Three original stereo demo tracks generated locally as WAV audio: Midnight Circuit, Soft Focus and Afterglow. No copyrighted sample recordings, external audio requests or binary audio downloads.
- Multi-file audio import and drag/drop, current track selection, removal and a searchable session library.
- Play, pause, stop, previous, next, seek, volume, mute, nonrepeating shuffle cycles with history, repeat-current-track and repeat-playlist.
- Real 18-band Web Audio equalizer (original-style ten-band BASIC subset), ±15 dB preamp/bands, bypass, calculated response and locally saved custom presets.
- Independent left/right channel balance; browser echo, reverb, chorus and flanger wet/dry controls; alternative speed/tempo modes; an analyser-driven spectrum.
- Original-inspired menus and SETTINGS utilities: read-only file info, local library/search, A–B repeat, playback sleep timer and shortcut help. Configurable panels, compact player and device-local preferences.
- Responsive desktop/mobile layout and labelled keyboard-accessible controls. Space toggles playback when focus is outside a control.

## Audio and privacy

AudioContext starts only after a playback gesture. Imported files use temporary Blob URLs and never leave the browser. Settings are saved in localStorage; imported file access and playlist changes last only for the current page session. Refreshing restores the demo playlist. Local track names are filenames, not fabricated tag metadata. Unknown durations are shown as unknown until decoded.

MP3 and WAV work in most modern browsers; FLAC, AAC/M4A, OGG and Opus availability depends on the browser and installed codecs. DRM-protected media and streaming services are not supported. Browsers may suspend background playback. Loud EQ boosts can clip; reduce the preamp for headroom. Balance attenuates the opposite channel without crossfeeding it. Browser effects are approximations, not the original AIMP DSP algorithms. Tempo requests browser pitch preservation; speed changes pitch. Those controls are mutually exclusive.

Demo WAVs are synthesized from code in `src/audio.ts`; durations, sizes and WAV format labels correspond to the actual generated media. The normal playlist stops after the final track, repeat loops the current track, and shuffle traverses every track before starting a new cycle; Previous retraces shuffle history. Manual Next wraps.

## Structure

- `src/main.tsx` — React player, menus, library and interaction state
- `src/style.css` — responsive beveled-chrome skin
- `src/audio.ts` — lazy Web Audio engine and original demo synthesis
- `src/model.ts` — track model, 18-band mappings and web presets
- `src/settings.ts` — validated/versioned device-local preferences and legacy migration
- `src/sequencing.ts` — nonrepeating shuffle cycles and stable-ID playback history
- `src/*.test.ts` — deterministic audio and model tests

The artwork is CSS/SVG, with no image scraping. UI fonts fall back to local system fonts if Google Fonts is unavailable.

## Browser tests

```sh
npx playwright install chromium
npm run test:e2e
```

The expanded Playwright suite covers playback, seeking, repeated changes, original BASIC/enhanced EQ controls, balance, browser effects, presets, preference persistence, A–B repeat, repeat playlist, sleep timer, shuffle history and mobile overflow. Local Chromium execution was not attempted for this update because the environment’s previous browser restriction remains in force. Run the suite in GitHub Actions before claiming live browser verification of these changes. Earlier browser results apply only to the earlier implementation. Real iOS/Safari behavior and audible/native-AIMP equivalence remain unverified.

## Fidelity boundaries

The BASIC subset uses native band indices 2, 4, 6, 8, 9, 10, 12, 14, 16 and 18, with ±15 dB controls. Its 700 Hz label is a best-supported interpretation of the supplied photograph; the exact photographed build and native filter curves are not established. ENH EQ exposes all 18 bands; hidden bands remain active. Presets other than Flat are explicitly labelled web curves. Existing ten-band saved preferences migrate by log-frequency interpolation, rounded to the controls’ 0.5 dB steps, so the prior curve is retained approximately rather than silently reset.

The response plot is the steady-state digital peaking-filter response, summed with preamp, at the active AudioContext sample rate (48 kHz preview before playback). It is clipped visually at ±15 dB and flattens when bypassed. It is not a measurement of output, DSP effects, speakers or native AIMP. EQ boosts can still clip. Pause/Stop mute output immediately; quick resume/track changes can retain a short residual effect tail because wet processors are not flushed.

Imported file format labels come only from extensions; unknown channel count/sample rate/codec are left unknown. Demo metadata is known PCM WAV metadata. Delayed playback metadata updates both current duration and playlist totals. A–B repeat uses media time updates, so it is not sample-accurate or gapless. Sleep timer pauses this tab, never the operating system, and background suspension may delay it.

Native-only or unimplemented items are disclosed rather than given misleading replacement actions: radio capture, URL/folder/playlist-file import, export, tag editing/conversion, native plugins, independent pitch, TrueBass/Enhancer, normalization/cross-mixing/silence removal, OS shutdown/topmost/window controls, lyrics/cover-art panes, language packs and a persistent multi-playlist library. No uploaded audio, tracking, accounts or native code are added.

Primary reference: [official AIMP Modern skin](https://www.aimp.ru/?do=catalog&rec_id=604), version 3.63 skin bindings and the supplied screenshot. This remains an unofficial browser adaptation, not one-to-one native compatibility.
