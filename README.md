# AIMP Modern · Web Edition

A working React + TypeScript music player inspired by the supplied silver-and-blue AIMP Modern desktop skin. Independent and unofficial; no affiliation with AIMP or Winamp.

## Run locally

Requires Node.js 20.19+ or 22.12+.

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
- Play, pause, stop, previous, next, seek, volume, mute, random shuffle and repeat-current-track.
- Real 10-band Web Audio equalizer with preamp, bypass, six presets and live response display.
- Stereo panning, a feedback echo effect with wet/dry control, and an analyser-driven spectrum.
- Configurable panels, a compact player, menus and device-local audio preferences.
- Responsive desktop/mobile layout and labelled keyboard-accessible controls. Space toggles playback when focus is outside a control.

## Audio and privacy

AudioContext starts only after a playback gesture. Imported files use temporary Blob URLs and never leave the browser. Settings are saved in localStorage; imported file access and playlist changes last only for the current page session. Refreshing restores the demo playlist. Local track names are filenames, not fabricated tag metadata. Unknown durations are shown as unknown until decoded.

MP3 and WAV work in most modern browsers; FLAC, AAC/M4A, OGG and Opus availability depends on the browser and installed codecs. DRM-protected media and streaming services are not supported. Browsers may suspend background playback. Loud EQ boosts can clip; reduce the preamp for headroom. This is a stereo panner, not independent left/right channel attenuation.

Demo WAVs are synthesized from code in `src/audio.ts`; durations, sizes and WAV format labels correspond to the actual generated media. The normal playlist stops after the final track, repeat loops the current track, and shuffle avoids immediately selecting the same track when possible.

## Structure

- `src/main.tsx` — React player, menus, library and interaction state
- `src/style.css` — responsive beveled-chrome skin
- `src/audio.ts` — lazy Web Audio engine and original demo synthesis
- `src/model.ts` — track model, EQ presets and playlist utilities
- `src/*.test.ts` — deterministic audio and model tests

The artwork is CSS/SVG, with no image scraping. UI fonts fall back to local system fonts if Google Fonts is unavailable.

## Browser tests

```sh
npx playwright install chromium
npm run test:e2e
```

The Playwright suite covers real browser playback, seeking, repeated track changes, EQ and echo controls, dialog dismissal, library search, panel restoration and mobile overflow. Unit tests and the production build were run successfully in the build environment. Browser tests could not be run there because Chromium process startup was blocked by the execution environment's socket restrictions; they are provided for a browser-capable environment.
