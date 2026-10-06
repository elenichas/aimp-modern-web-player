import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioEngine, createDemoTracks, calculateEQResponse } from "./audio";
import {
  EQ_PRESETS,
  EQ_FREQUENCIES,
  formatTime,
  BASIC_EQ_INDICES,
  getPresetName,
} from "./model";
import type { Track } from "./model";
import { PlaybackSequence } from "./sequencing";
import "./style.css";

import {
  defaults,
  parseSettings,
  MAX_USER_PRESETS,
  sanitizePresetName,
} from "./settings";
import type { Settings } from "./settings";
function readSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem("modern-player-settings"));
  } catch {
    return parseSettings(null);
  }
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m8 4 13 8-13 8Z" />,
    pause: (
      <>
        <path d="M7 4h4v16H7zM15 4h4v16h-4z" />
      </>
    ),
    stop: <path d="M5 5h14v14H5z" />,
    prev: (
      <>
        <path d="M4 5h3v14H4zM19 4 8 12l11 8Z" />
      </>
    ),
    next: (
      <>
        <path d="M17 5h3v14h-3zM5 4l11 8L5 20Z" />
      </>
    ),
    eject: (
      <>
        <path d="m4 14 8-10 8 10ZM4 17h16v3H4z" />
      </>
    ),
    volume: (
      <>
        <path d="M3 9h5l5-5v16l-5-5H3Z" />
        <path
          d="M16 8q6 4 0 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </>
    ),
    mute: (
      <>
        <path d="M3 9h5l5-5v16l-5-5H3Z" />
        <path
          d="m16 9 5 6m0-6-5 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </>
    ),
    shuffle: (
      <path
        d="M3 6h3c5 0 6 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    ),
    repeat: (
      <path
        d="M19 8a7 7 0 0 0-12-3L3 9m0-6v6h6m-4 7a7 7 0 0 0 12 3l4-4m0 6v-6h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
function App() {
  const [engine] = useState(() => new AudioEngine());
  const [tracks, setTracks] = useState<Track[]>(() => createDemoTracks());
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settings, setSettings] = useState(readSettings);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [eqVisible, setEqVisible] = useState(true);
  const [playlistVisible, setPlaylistVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("equalizer");
  const [dialog, setDialog] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState("Ready. Press play to begin.");
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [presetName, setPresetName] = useState("");
  const [response, setResponse] = useState<number[]>([]);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const preset = getPresetName(settings.gains, settings.preamp, {
    ...EQ_PRESETS,
    ...settings.userPresets,
  });
  const sequence = useRef(new PlaybackSequence());
  const frequencies = Array.from(
    { length: 120 },
    (_, i) => 20 * (20000 / 20) ** (i / 119),
  );
  const loop = useRef({ a: loopA, b: loopB });
  loop.current = { a: loopA, b: loopB };
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useRef<string[]>([]);
  const state = useRef({ tracks, current, settings });
  state.current = { tracks, current, settings };
  const playRequest = useRef(0);
  const track = tracks[current];
  const update = (s: Partial<Settings>) => setSettings((v) => ({ ...v, ...s }));
  useEffect(() => {
    sequence.current.sync(
      tracks.map((t) => t.id),
      tracks[current]?.id ?? null,
      settings.shuffle,
    );
  }, [tracks, current, settings.shuffle]);
  useEffect(() => {
    urls.current.push(
      ...tracks.filter((t) => t.source === "demo").map((t) => t.url),
    );
    return () => {
      engine.dispose();
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, [engine]);
  useEffect(() => {
    try {
      localStorage.setItem("modern-player-settings", JSON.stringify(settings));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    engine.setVolume(settings.volume);
    engine.setMuted(settings.muted);
    engine.setEQ(settings.gains, settings.preamp, settings.eq);
    engine.setBalance(settings.balance);
    engine.setEffects(settings);
    setResponse(
      calculateEQResponse(
        frequencies,
        settings.gains,
        settings.preamp,
        settings.eq,
        engine.sampleRate,
      ),
    );
  }, [settings, engine]);
  const play = async () => {
    if (!state.current.tracks.length) {
      setNotice("Import audio files to start listening.");
      return;
    }
    const request = ++playRequest.current;
    try {
      await engine.play();
      const activeSettings = state.current.settings;
      setResponse(
        calculateEQResponse(
          frequencies,
          activeSettings.gains,
          activeSettings.preamp,
          activeSettings.eq,
          engine.sampleRate,
        ),
      );
      if (request === playRequest.current) setNotice("");
    } catch {
      if (request === playRequest.current) {
        setPlaying(false);
        setNotice(
          "Could not play this file. Try a browser-supported audio format.",
        );
      }
    }
  };
  const select = (index: number, autoplay = true) => {
    if (index < 0 || index >= state.current.tracks.length) return;
    state.current.current = index;
    sequence.current.sync(
      state.current.tracks.map((item) => item.id),
      state.current.tracks[index].id,
      state.current.settings.shuffle,
    );
    setCurrent(index);
    setLoopA(null);
    setLoopB(null);
    loop.current = { a: null, b: null };
    setElapsed(0);
    const t = state.current.tracks[index];
    engine.load(t.url);
    setDuration(t.duration);
    if (autoplay) void play();
  };
  const advance = (direction = 1, wrap = true) => {
    const s = state.current;
    if (!s.tracks.length) return false;
    sequence.current.sync(
      s.tracks.map((t) => t.id),
      s.tracks[s.current]?.id ?? null,
      s.settings.shuffle,
    );
    const id =
      direction < 0
        ? sequence.current.previous(wrap)
        : sequence.current.next(wrap);
    if (id !== null) {
      select(s.tracks.findIndex((t) => t.id === id));
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (tracks[0]) engine.load(tracks[0].url);
    const a = engine.audio;
    const time = () => {
      const { a: start, b: end } = loop.current;
      if (start !== null && end !== null && a.currentTime >= end)
        a.currentTime = start;
      setElapsed(a.currentTime);
    };
    const metadata = () => {
      const knownDuration = Number.isFinite(a.duration) ? a.duration : 0;
      setDuration(knownDuration);
      if (knownDuration > 0)
        setTracks((list) =>
          list.map((t) =>
            t.url === a.src ? { ...t, duration: knownDuration } : t,
          ),
        );
    };
    const start = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const error = () => {
      setPlaying(false);
      setNotice(
        "This audio could not be decoded. See Help for supported formats.",
      );
    };
    const end = () => {
      const s = state.current;
      if (loop.current.a !== null && loop.current.b !== null) {
        a.currentTime = loop.current.a;
        void play();
      } else if (s.settings.repeat) {
        a.currentTime = 0;
        void play();
      } else if (!advance(1, s.settings.repeatPlaylist)) {
        engine.stop();
        setPlaying(false);
        setElapsed(0);
        setNotice("End of playlist.");
      }
    };
    a.addEventListener("timeupdate", time);
    a.addEventListener("loadedmetadata", metadata);
    a.addEventListener("play", start);
    a.addEventListener("pause", pause);
    a.addEventListener("ended", end);
    a.addEventListener("error", error);
    return () => {
      a.removeEventListener("timeupdate", time);
      a.removeEventListener("loadedmetadata", metadata);
      a.removeEventListener("play", start);
      a.removeEventListener("pause", pause);
      a.removeEventListener("ended", end);
      a.removeEventListener("error", error);
    };
  }, [engine]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const el = canvas.current;
      if (el) {
        const ctx = el.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, el.width, el.height);
          if (!settings.visual) {
            frame = requestAnimationFrame(draw);
            return;
          }
          const data = new Uint8Array(
            engine.analyser?.frequencyBinCount || 128,
          );
          engine.analyser?.getByteFrequencyData(data);
          const bars = 32;
          for (let i = 0; i < bars; i++) {
            const val =
              playing && settings.visual
                ? data[Math.floor((i * data.length) / 80)] / 255
                : 0;
            const h = Math.round(val * 13);
            for (let j = 0; j <= h; j++) {
              ctx.fillStyle = j > 10 ? "#eff8ef" : "#b7cadd";
              ctx.globalAlpha = 0.35 + j / 22;
              ctx.fillRect(i * 6, 58 - j * 4, 4, 2);
            }
          }
          ctx.globalAlpha = 1;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [engine, playing, settings.visual]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setDialog(null);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag) ||
        dialog ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        playing ? engine.pause() : void play();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [playing, dialog]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>("[role=dialog]");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDialog(null);
        return;
      }
      if (e.key === "Tab" && modal) {
        const items = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button,input,select,[tabindex="0"]',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const importFiles = async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter(
      (f) =>
        f.type.startsWith("audio/") ||
        /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.name),
    );
    if (!accepted.length) {
      setNotice("Choose audio files such as MP3, WAV, FLAC, M4A or OGG.");
      return;
    }
    const imported = await Promise.all(
      accepted.map(async (f) => {
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        const d = await new Promise<number>((resolve) => {
          const a = new Audio();
          const timer = setTimeout(() => {
            a.removeAttribute("src");
            resolve(0);
          }, 4000);
          a.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve(Number.isFinite(a.duration) ? a.duration : 0);
            a.removeAttribute("src");
          };
          a.onerror = () => {
            clearTimeout(timer);
            resolve(0);
            a.removeAttribute("src");
          };
          a.src = url;
        });
        return {
          id: crypto.randomUUID(),
          title: f.name.replace(/\.[^.]+$/, ""),
          artist: "Local file",
          url,
          duration: d,
          format: f.name.split(".").pop()?.toUpperCase() || "AUDIO",
          size: f.size,
          source: "local" as const,
        };
      }),
    );
    const empty = state.current.tracks.length === 0;
    setTracks((v) => [...v, ...imported]);
    if (empty) {
      setLoopA(null);
      setLoopB(null);
      loop.current = { a: null, b: null };
      setCurrent(0);
      engine.load(imported[0].url);
      setDuration(imported[0].duration);
    }
    setNotice(
      `Added ${imported.length} local ${imported.length === 1 ? "track" : "tracks"}. Files stay on this device.`,
    );
  };
  const remove = (id: string) => {
    const s = state.current;
    const index = s.tracks.findIndex((t) => t.id === id);
    const remaining = s.tracks.filter((t) => t.id !== id);
    if (index === s.current) {
      setLoopA(null);
      setLoopB(null);
      loop.current = { a: null, b: null };
      engine.stop();
      setElapsed(0);
      const next = Math.min(index, remaining.length - 1);
      setCurrent(Math.max(0, next));
      setDuration(remaining[next]?.duration || 0);
      if (remaining[next]) engine.load(remaining[next].url);
    } else if (index < s.current) setCurrent((v) => v - 1);
    setTracks(remaining);
    const removed = s.tracks[index];
    if (removed) {
      URL.revokeObjectURL(removed.url);
      urls.current = urls.current.filter((url) => url !== removed.url);
    }
  };
  const applyPreset = (name: string) => {
    const p = EQ_PRESETS[name] || settings.userPresets[name];
    if (p) {
      update({ gains: [...p.gains], preamp: p.preamp });
    }
  };
  const showPanel = (name: string) => {
    setCollapsed(false);
    setEqVisible(true);
    setTab(name);
  };
  const stop = () => {
    engine.stop();
    setElapsed(0);
    setNotice("Stopped.");
  };
  const setAB = () => {
    if (loopA === null) {
      setLoopA(elapsed);
      setNotice(`A set at ${formatTime(elapsed)}. Set B later in the track.`);
    } else if (loopB === null && elapsed > loopA + 0.25) {
      setLoopB(elapsed);
      setNotice("A–B repeat enabled.");
    } else if (loopB !== null) {
      setLoopA(null);
      setLoopB(null);
      setNotice("A–B repeat cleared.");
    } else setNotice("B must be after A. Seek or play forward first.");
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      if (sleepUntil !== null && now >= sleepUntil) {
        engine.pause();
        setSleepUntil(null);
        setNotice("Sleep timer paused playback.");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [sleepUntil, engine]);
  const menuActions: Record<string, { label: string; action: () => void }[]> = {
    File: [
      { label: "Open audio files…", action: () => input.current?.click() },
      { label: "View file info", action: () => setDialog("fileinfo") },
      { label: "Clear session playlist…", action: () => setDialog("clear") },
      {
        label: "Desktop-only file actions…",
        action: () => setDialog("limits"),
      },
    ],
    Play: [
      { label: "Play", action: () => void play() },
      { label: "Pause", action: () => engine.pause() },
      { label: "Stop", action: stop },
      { label: "Next", action: () => advance() },
      { label: "Prev", action: () => advance(-1) },
      {
        label: `${settings.repeat ? "✓ " : ""}Repeat current track`,
        action: () => update({ repeat: !settings.repeat }),
      },
      {
        label: `${settings.repeatPlaylist ? "✓ " : ""}Repeat playlist`,
        action: () => update({ repeatPlaylist: !settings.repeatPlaylist }),
      },
      {
        label: `${settings.shuffle ? "✓ " : ""}Shuffle`,
        action: () => update({ shuffle: !settings.shuffle }),
      },
      { label: "A–B repeat", action: setAB },
      {
        label: "Volume Down",
        action: () => update({ volume: Math.max(0, settings.volume - 0.05) }),
      },
      {
        label: `${settings.muted ? "✓ " : ""}Volume Mute`,
        action: () => update({ muted: !settings.muted }),
      },
      {
        label: "Volume Up",
        action: () => update({ volume: Math.min(1, settings.volume + 0.05) }),
      },
    ],
    Options: [
      { label: "Skin settings", action: () => setDialog("skin") },
      { label: "Hotkeys settings", action: () => setDialog("hotkeys") },
      {
        label: "Language / plugins / native options",
        action: () => setDialog("limits"),
      },
      {
        label: "Shutdown settings (sleep timer)",
        action: () => {
          showPanel("settings");
          setDialog("timer");
        },
      },
      { label: "Settings", action: () => showPanel("settings") },
    ],
    View: [
      {
        label: `${eqVisible ? "✓ " : ""}Equalizer`,
        action: () => {
          setCollapsed(false);
          setEqVisible(!eqVisible);
        },
      },
      {
        label: "DSP Manager / Sound Effect",
        action: () => showPanel("effect"),
      },
      { label: "EQ Equalizer", action: () => showPanel("equalizer") },
      {
        label: `${playlistVisible ? "✓ " : ""}Playlist`,
        action: () => {
          setCollapsed(false);
          setPlaylistVisible(!playlistVisible);
        },
      },
      { label: "Music Library", action: () => setDialog("library") },
      { label: "Start Search", action: () => setDialog("library") },
      {
        label: `${settings.visual ? "✓ " : ""}Visualization (LCD spectrum)`,
        action: () => {
          setCollapsed(false);
          update({ visual: !settings.visual });
        },
      },
      { label: "Compact player", action: () => setCollapsed(!collapsed) },
      { label: "Other native views…", action: () => setDialog("limits") },
    ],
    Help: [
      { label: "Help", action: () => setDialog("help") },
      { label: "Skin Info", action: () => setDialog("skin") },
      { label: "About", action: () => setDialog("about") },
    ],
  };
  const savePreset = () => {
    const name = sanitizePresetName(presetName);
    if (!name) {
      setNotice(
        "Choose a nonempty preset name that is not a factory or reserved name.",
      );
      return;
    }
    if (Object.hasOwn(EQ_PRESETS, name)) {
      setNotice("Choose a different name from the built-in web presets.");
      return;
    }
    if (Object.hasOwn(settings.userPresets, name)) {
      setNotice(
        "That preset already exists. Delete it first or choose a new name.",
      );
      return;
    }
    if (Object.keys(settings.userPresets).length >= MAX_USER_PRESETS) {
      setNotice(
        `You can save up to ${MAX_USER_PRESETS} presets. Delete one first.`,
      );
      return;
    }
    update({
      userPresets: {
        ...settings.userPresets,
        [name]: { gains: [...settings.gains], preamp: settings.preamp },
      },
    });
    setPresetName("");
    setNotice(`Saved preset: ${name}`);
  };
  const titles: Record<string, string> = {
    presets: "EQUALIZER PRESETS",
    eqmenu: "EQUALIZER OPTIONS",
    library: "MUSIC LIBRARY",
    help: "USING MODERN",
    clear: "CLEAR PLAYLIST",
    fileinfo: "FILE INFORMATION",
    timer: "SLEEP TIMER",
    hotkeys: "HOTKEYS",
    skin: "SKIN INFORMATION",
    limits: "NATIVE FEATURES",
    about: "ABOUT MODERN",
  };
  const total = tracks.reduce((a, t) => a + t.duration, 0);
  const size = tracks.reduce((a, t) => a + t.size, 0);
  return (
    <main
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        ref={input}
        multiple
        accept="audio/*,.flac,.opus,.m4a"
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className={`player-stack ${dragging ? "dragging" : ""}`}>
        <section className="main-player chrome" aria-label="Music player">
          <header className="titlebar">
            <button
              className="tiny-logo"
              aria-label="Main menu"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === "File" ? null : "File");
              }}
            >
              ◩
            </button>
            <span className="title-rail" />
            <h1>
              AIMP <b>MODERN</b>
            </h1>
            <span className="title-rail" />
            <button
              aria-label={collapsed ? "Expand player" : "Collapse player"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? "▣" : "−"}
            </button>
            <button aria-label="Open help" onClick={() => setDialog("help")}>
              ?
            </button>
          </header>
          <nav className="menubar" aria-label="Player menu">
            {Object.keys(menuActions).map((name) => (
              <div className="menu-wrap" key={name}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === name ? null : name);
                  }}
                  aria-expanded={menu === name}
                >
                  {name}
                </button>
                {menu === name && (
                  <div className="dropdown">
                    {menuActions[name].map((a) => (
                      <button key={a.label} onClick={a.action}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <span className="edition">WEB EDITION</span>
          </nav>
          {!collapsed && (
            <>
              <div className="display-row">
                <div className="lcd">
                  <div className="lcd-top">
                    <span className={`play-indicator ${playing ? "lit" : ""}`}>
                      ▶
                    </span>
                    <div
                      className="digital"
                      aria-label={`Elapsed ${formatTime(elapsed)}`}
                    >
                      {formatTime(elapsed).padStart(5, "0")}
                    </div>
                    <div className="audio-info">
                      <div>
                        <small>kHz</small>
                        <b>{track?.source === "demo" ? "22.05" : "—"}</b>
                      </div>
                      <div>
                        <b>{track?.source === "demo" ? "STEREO" : "CH —"}</b>
                        <b
                          title={
                            track?.source === "local"
                              ? "File extension; codec unverified"
                              : "Generated PCM WAV"
                          }
                        >
                          {track?.format || "—"}
                        </b>
                      </div>
                    </div>
                    <canvas
                      ref={canvas}
                      width="192"
                      height="62"
                      aria-label="Live frequency spectrum"
                    />
                  </div>
                  <div className="now-playing">
                    <span>
                      {track
                        ? `${track.artist} · ${track.title}`
                        : "Your next favorite starts here"}{" "}
                      <i> :: {track?.format || "AUDIO"} :: </i>
                    </span>
                  </div>
                </div>
                <aside className="lcd-side">
                  <label>VISUAL</label>
                  <button
                    className="pill"
                    aria-label="Toggle spectrum"
                    aria-pressed={settings.visual}
                    onClick={() => update({ visual: !settings.visual })}
                  >
                    ▾
                  </button>
                  <button
                    className={`pill icon-pill ${settings.repeat ? "active" : ""}`}
                    aria-label="Repeat current track"
                    aria-pressed={settings.repeat}
                    onClick={() => update({ repeat: !settings.repeat })}
                  >
                    <Icon name="repeat" />
                  </button>
                  <button
                    className={`pill icon-pill ${settings.shuffle ? "active" : ""}`}
                    aria-label="Shuffle"
                    aria-pressed={settings.shuffle}
                    onClick={() => update({ shuffle: !settings.shuffle })}
                  >
                    <Icon name="shuffle" />
                  </button>
                </aside>
              </div>
              <div className="seek-row">
                <input
                  aria-label="Seek"
                  type="range"
                  min="0"
                  max={duration || track?.duration || 1}
                  step="0.1"
                  value={Math.min(elapsed, duration || track?.duration || 1)}
                  onChange={(e) => {
                    engine.audio.currentTime = Number(e.target.value);
                    setElapsed(Number(e.target.value));
                  }}
                />
                <div className="panel-buttons">
                  <button
                    className="pill"
                    aria-label="Add music"
                    onClick={() => input.current?.click()}
                  >
                    <Icon name="eject" />
                  </button>
                  <button
                    className={`pill ${playlistVisible ? "active-subtle" : ""}`}
                    aria-label="Toggle playlist"
                    aria-pressed={playlistVisible}
                    onClick={() => setPlaylistVisible(!playlistVisible)}
                  >
                    PL
                  </button>
                  <button
                    className="pill"
                    aria-label="Music library"
                    onClick={() => setDialog("library")}
                  >
                    ML
                  </button>
                </div>
              </div>
            </>
          )}
          <div className="transport-row">
            <div className="transport">
              {[
                ["prev", "Previous track"],
                ["play", "Play"],
                ["pause", "Pause"],
                ["stop", "Stop"],
                ["next", "Next track"],
              ].map(([name, label]) => (
                <button
                  key={name}
                  className={`round ${name === "play" ? "play-button" : ""} ${name === "play" && playing ? "pressed" : ""}`}
                  aria-label={label}
                  onClick={() =>
                    name === "prev"
                      ? advance(-1)
                      : name === "next"
                        ? advance()
                        : name === "play"
                          ? void play()
                          : name === "pause"
                            ? engine.pause()
                            : stop()
                  }
                >
                  <Icon name={name} />
                </button>
              ))}
            </div>
            <div className="volume">
              <button
                className="round mini"
                aria-label={settings.muted ? "Unmute" : "Mute"}
                onClick={() => update({ muted: !settings.muted })}
              >
                <Icon name={settings.muted ? "mute" : "volume"} />
              </button>
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={settings.volume}
                onChange={(e) => update({ volume: Number(e.target.value) })}
              />
            </div>
            <button
              className="config"
              onClick={() => {
                setCollapsed(false);
                setEqVisible(!eqVisible);
                setTab("equalizer");
              }}
              aria-label="Toggle configuration"
              aria-pressed={eqVisible}
            >
              CONFIG
            </button>
            <button
              className="about-logo"
              aria-label="About player"
              onClick={() => setDialog("about")}
            >
              △
            </button>
          </div>
        </section>
        {eqVisible && !collapsed && (
          <section
            className="equalizer-shell chrome"
            aria-label="Audio configuration"
          >
            <div className="eq-body">
              <div className="eq-heading">
                <h2>
                  AIMP EQUALIZER
                  <span>
                    {tab === "equalizer"
                      ? settings.advanced
                        ? "ENHANCED · 18 BANDS"
                        : "BASIC"
                      : tab === "effect"
                        ? "DSP EFFECTS"
                        : "PREFERENCES"}
                  </span>
                </h2>
                <div className="response">
                  <span>
                    +15 dB
                    <br />0 dB
                    <br />
                    −15 dB
                  </span>
                  <svg
                    viewBox="0 0 300 35"
                    preserveAspectRatio="none"
                    aria-label="Calculated equalizer response, ±15 dB display, including preamp"
                  >
                    <line
                      x1="0"
                      y1="17.5"
                      x2="300"
                      y2="17.5"
                      stroke="#93999d"
                      strokeWidth="1"
                    />
                    <polyline
                      points={response
                        .map(
                          (v, i) =>
                            `${(i * 300) / 119},${17.5 - (Math.max(-15, Math.min(15, Number.isFinite(v) ? v : 0)) * 17.5) / 15}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke="#374959"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
              </div>
              {tab === "equalizer" ? (
                <div className="eq-controls">
                  <div className="eq-sidebar">
                    <div className="balance-label">
                      L <span>◁ ◇ ▷</span> R
                    </div>
                    <input
                      aria-label="Stereo balance"
                      type="range"
                      min="-1"
                      max="1"
                      step=".05"
                      value={settings.balance}
                      onChange={(e) =>
                        update({ balance: Number(e.target.value) })
                      }
                    />
                    <button
                      className="pill dsp"
                      onClick={() => setTab("effect")}
                    >
                      DSP MANAGER
                    </button>
                    <div className="eq-switches">
                      <button
                        className={`pill ${settings.eq ? "active" : ""}`}
                        aria-label="Enable equalizer"
                        aria-pressed={settings.eq}
                        onClick={() => update({ eq: !settings.eq })}
                      >
                        {settings.eq ? "ON" : "OFF"}
                      </button>
                      <span className={`led ${settings.eq ? "on" : ""}`} />
                      <button
                        className="pill"
                        onClick={() => setDialog("eqmenu")}
                      >
                        PRESETS
                      </button>
                      <button
                        className="pill"
                        onClick={() => setDialog("presets")}
                      >
                        EQ PRES
                      </button>
                    </div>
                  </div>
                  <div
                    className={`faders ${settings.advanced ? "advanced-faders" : ""} ${settings.eq ? "" : "bypassed"}`}
                  >
                    <div className="fader preamp">
                      <input
                        aria-label="Preamp"
                        type="range"
                        min="-15"
                        max="15"
                        step=".5"
                        value={settings.preamp}
                        onChange={(e) => {
                          update({ preamp: Number(e.target.value) });
                        }}
                      />
                      <span>PREAMP</span>
                    </div>
                    <div className="db-scale">
                      <span>+15</span>
                      <span>0 dB</span>
                      <span>−15</span>
                    </div>
                    {(settings.advanced
                      ? EQ_FREQUENCIES.map((_, i) => i)
                      : BASIC_EQ_INDICES
                    ).map((i) => {
                      const hz = EQ_FREQUENCIES[i];
                      return (
                        <div className="fader" key={hz}>
                          <input
                            aria-label={`${hz} Hz`}
                            title={`${hz} Hz: ${settings.gains[i]} dB`}
                            type="range"
                            min="-15"
                            max="15"
                            step=".5"
                            value={settings.gains[i]}
                            onChange={(e) => {
                              const gains = [...settings.gains];
                              gains[i] = Number(e.target.value);
                              update({ gains });
                            }}
                          />
                          <span>{hz >= 1000 ? `${hz / 1000}K` : hz}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : tab === "effect" ? (
                <div className="other-settings effects-grid">
                  <p className="wide">
                    Web Audio approximations, not AIMP DSP algorithms. Effect
                    amounts are wet/dry mixes.
                  </p>
                  {(["echo", "reverb", "chorus", "flanger"] as const).map(
                    (effect) => (
                      <label key={effect}>
                        <span>{effect.toUpperCase()}</span>
                        <input
                          aria-label={`${effect[0].toUpperCase() + effect.slice(1)} amount`}
                          type="range"
                          min="0"
                          max="1"
                          step=".01"
                          value={settings[effect]}
                          onChange={(e) =>
                            update({ [effect]: Number(e.target.value) })
                          }
                        />
                        <output aria-label={`${effect} value`}>
                          {Math.round(settings[effect] * 100)}%
                        </output>
                      </label>
                    ),
                  )}
                  {(["speed", "tempo"] as const).map((effect) => (
                    <label key={effect}>
                      <span>{effect.toUpperCase()}</span>
                      <input
                        aria-label={
                          effect === "speed"
                            ? "Speed with pitch"
                            : "Tempo preserving pitch"
                        }
                        type="range"
                        disabled={
                          effect === "tempo" &&
                          !engine.supportsPitchPreservation
                        }
                        min=".5"
                        max="2"
                        step=".05"
                        value={settings[effect]}
                        onChange={(e) =>
                          update({
                            speed: 1,
                            tempo: 1,
                            [effect]: Number(e.target.value),
                          })
                        }
                      />
                      <output>{settings[effect].toFixed(2)}×</output>
                    </label>
                  ))}
                  <p className="wide">
                    {!engine.supportsPitchPreservation &&
                      "Pitch preservation is unavailable here: Tempo is disabled and Speed uses browser-controlled pitch. "}
                    Speed changes pitch when supported; Tempo requests browser
                    pitch preservation. They are alternative modes. Independent
                    Pitch, TrueBass and Enhancer require native DSP and are
                    unavailable.
                  </p>
                  <button
                    className="pill"
                    onClick={() =>
                      update({
                        echo: 0,
                        reverb: 0,
                        chorus: 0,
                        flanger: 0,
                        speed: 1,
                        tempo: 1,
                      })
                    }
                  >
                    RESET EFFECTS
                  </button>
                </div>
              ) : (
                <div className="other-settings settings-grid">
                  <div className="utility-grid">
                    <button
                      className="pill"
                      onClick={() => setDialog("fileinfo")}
                    >
                      FILE INFO
                    </button>
                    <button className="pill" onClick={() => setDialog("timer")}>
                      SLEEP TIMER
                    </button>
                    <button
                      className="pill"
                      onClick={() => setDialog("library")}
                    >
                      AUDIO LIBRARY
                    </button>
                    <button
                      className="pill"
                      onClick={() => setDialog("library")}
                    >
                      SEARCH
                    </button>
                    <button
                      className="pill"
                      onClick={() => setDialog("hotkeys")}
                    >
                      HOTKEYS
                    </button>
                    <button className="pill" onClick={setAB}>
                      {loopB !== null
                        ? "CLEAR A–B"
                        : loopA !== null
                          ? "SET B"
                          : "SET A"}
                    </button>
                    <button className="pill" onClick={() => setDialog("skin")}>
                      SKIN INFO
                    </button>
                    <button
                      className="pill"
                      onClick={() => setDialog("limits")}
                    >
                      NATIVE UTILITIES
                    </button>
                  </div>
                  <p>
                    A–B:{" "}
                    {loopA === null
                      ? "off"
                      : `${formatTime(loopA)} → ${loopB === null ? "set B" : formatTime(loopB)}`}{" "}
                    · Sleep:{" "}
                    {sleepUntil === null
                      ? "off"
                      : formatTime((sleepUntil - clockNow) / 1000)}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.repeatPlaylist}
                      onChange={(e) =>
                        update({ repeatPlaylist: e.target.checked })
                      }
                    />{" "}
                    Repeat playlist
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.visual}
                      onChange={(e) => update({ visual: e.target.checked })}
                    />{" "}
                    Live spectrum visualization
                  </label>
                  <p>
                    {storageAvailable
                      ? "Preferences and custom presets stay in this browser."
                      : "Browser storage is unavailable; preferences last only this session."}{" "}
                    Local audio is never uploaded and must be re-added after
                    refresh.
                  </p>
                  <button
                    className="pill"
                    onClick={() => {
                      setSettings({ ...defaults, gains: [...defaults.gains] });
                      setLoopA(null);
                      setLoopB(null);
                      setSleepUntil(null);
                    }}
                  >
                    RESTORE DEFAULTS
                  </button>
                </div>
              )}
            </div>
            <div className="eq-tabs">
              {["equalizer", "effect", "settings"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {t.toUpperCase()}
                </button>
              ))}
              <button
                className="pill eq-mode"
                aria-label="Toggle enhanced equalizer"
                aria-pressed={settings.advanced}
                onClick={() => {
                  showPanel("equalizer");
                  update({ advanced: !settings.advanced });
                }}
              >
                {settings.advanced ? "BASIC EQ" : "ENH EQ"}
              </button>
              <button
                className="pill collapse-eq"
                aria-label="Hide equalizer"
                onClick={() => setEqVisible(false)}
              >
                ▴
              </button>
            </div>
          </section>
        )}
        {playlistVisible && !collapsed && (
          <section className="playlist chrome" aria-label="Playlist">
            <header className="titlebar">
              <span className="tiny-logo">▥</span>
              <span className="title-rail" />
              <h2>PLAYLIST EDITOR</h2>
              <span className="title-rail" />
              <button
                aria-label="Add files to playlist"
                onClick={() => input.current?.click()}
              >
                +
              </button>
              <button
                aria-label="Hide playlist"
                onClick={() => setPlaylistVisible(false)}
              >
                ×
              </button>
            </header>
            <div className="playlist-toolbar">
              <span className="playlist-name">MODERN SESSIONS</span>
              <span className="collection-count">
                {tracks.length.toString().padStart(2, "0")} TRACKS
              </span>
              <button onClick={() => setDialog("library")}>▤ Library</button>
            </div>
            <div className="track-list">
              {tracks.length ? (
                tracks.map((t, i) => (
                  <div
                    key={t.id}
                    className={`track ${i === current ? "selected" : ""}`}
                  >
                    <button
                      className="track-main"
                      onClick={() => select(i)}
                      aria-label={`Play ${t.title}`}
                    >
                      <span className="track-number">
                        {i === current && playing
                          ? "▶"
                          : String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="track-title">
                        {t.artist} <em>–</em> {t.title}
                      </span>
                      <time>{t.duration ? formatTime(t.duration) : "—:—"}</time>
                    </button>
                    <button
                      className="remove-track"
                      aria-label={`Remove ${t.title}`}
                      onClick={() => remove(t.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">
                  Your playlist is waiting.
                  <br />
                  <button onClick={() => input.current?.click()}>
                    Add your music
                  </button>
                </div>
              )}
              <button
                className="drop-zone"
                onClick={() => input.current?.click()}
              >
                <span>＋</span> DROP YOUR MUSIC HERE{" "}
                <small>or click to add audio files</small>
              </button>
            </div>
            <footer className="playlist-footer">
              <span>
                Time: <b>{formatTime(total)}</b>
              </span>
              <span>
                Tracks: <b>{tracks.length}</b>
              </span>
              <span>
                Size: <b>{(size / 1024 / 1024).toFixed(1)} MB</b>
              </span>
            </footer>
          </section>
        )}
      </div>
      <div className="under-player">
        <span className={`status-light ${playing ? "playing" : ""}`} />
        <span role="status">
          {notice ||
            (playing
              ? "Playing locally. Just you and the music."
              : "Paused. Take your time.")}
        </span>
      </div>
      <footer className="page-footer">
        OLD SOUL. NEW FREQUENCIES.<span>Made for the music.</span>
      </footer>
      {dragging && (
        <div className="drag-overlay">
          Drop audio files to add to your playlist
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="modal chrome"
            role="dialog"
            aria-modal="true"
            aria-label={dialog}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="titlebar">
              <h2>{titles[dialog] || "MODERN"}</h2>
              <button
                aria-label="Close dialog"
                autoFocus
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </header>
            <div className="modal-content">
              {dialog === "presets" || dialog === "eqmenu" ? (
                <>
                  <p>
                    Current:{" "}
                    <strong data-testid="current-preset">{preset}</strong>.
                    Factory curves are custom web presets, not AIMP presets.
                  </p>
                  {dialog === "eqmenu" && (
                    <div className="utility-grid">
                      <button
                        className="pill"
                        onClick={() => applyPreset("Flat")}
                      >
                        Reset EQ
                      </button>
                      <button
                        className="pill"
                        onClick={() => update({ eq: !settings.eq })}
                      >
                        {settings.eq ? "Bypass EQ" : "Enable EQ"}
                      </button>
                      <button
                        className="pill"
                        onClick={() => setDialog("presets")}
                      >
                        Choose preset
                      </button>
                    </div>
                  )}
                  <div className="preset-grid">
                    {Object.keys({
                      ...EQ_PRESETS,
                      ...settings.userPresets,
                    }).map((name) => (
                      <div className="preset-entry" key={name}>
                        <button
                          className={`pill ${preset === name ? "active" : ""}`}
                          onClick={() => applyPreset(name)}
                        >
                          {name}
                        </button>
                        {Object.hasOwn(settings.userPresets, name) && (
                          <button
                            className="pill"
                            aria-label={`Delete preset ${name}`}
                            onClick={() => {
                              const saved = { ...settings.userPresets };
                              delete saved[name];
                              update({ userPresets: saved });
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <label>
                    Preset name{" "}
                    <input
                      aria-label="Preset name"
                      maxLength={48}
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                  </label>
                  <button className="pill" onClick={savePreset}>
                    Save current preset
                  </button>
                  <p role="status">{notice}</p>
                  <p>
                    All 18 bands and preamp are saved. Switching BASIC/ENHANCED
                    changes which bands are shown, not the sound. Positive
                    boosts can clip; lower the preamp for headroom.
                  </p>
                </>
              ) : dialog === "fileinfo" ? (
                <>
                  <h3>{track?.title || "No track selected"}</h3>
                  <p>
                    {track?.artist} ·{" "}
                    {formatTime(duration || track?.duration || 0)} ·{" "}
                    {((track?.size || 0) / 1024 / 1024).toFixed(2)} MiB
                  </p>
                  <p>
                    {track?.source === "demo"
                      ? "Generated PCM WAV · 22.05 kHz · 16 bit · stereo · 705.6 kbps"
                      : `File extension: ${track?.format || "unknown"}. Codec, channel count, sample rate and embedded tags are not verified by this browser player.`}
                  </p>
                  <p>
                    Read-only information. Native tag editing and audio
                    conversion are unavailable.
                  </p>
                </>
              ) : dialog === "timer" ? (
                <>
                  <p>
                    Pause playback after the selected time. This does not shut
                    down your device. Background browser suspension may delay
                    the timer.
                  </p>
                  <label>
                    Sleep timer{" "}
                    <select
                      aria-label="Sleep timer"
                      value={sleepUntil === null ? "off" : "active"}
                      onChange={(e) => {
                        if (e.target.value === "off") setSleepUntil(null);
                        else if (e.target.value !== "active")
                          setSleepUntil(
                            Date.now() + Number(e.target.value) * 60000,
                          );
                      }}
                    >
                      <option value="off">Off</option>
                      {sleepUntil !== null && (
                        <option value="active">
                          {formatTime((sleepUntil - clockNow) / 1000)} remaining
                        </option>
                      )}
                      {[5, 15, 30, 60, 90].map((n) => (
                        <option key={n} value={n}>
                          {n} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>The timer is session-only and clears on reload.</p>
                </>
              ) : dialog === "hotkeys" ? (
                <>
                  <p>
                    Space: play / pause. Escape: dismiss menus or dialogs. Tab:
                    move between controls. Arrow keys: adjust a focused slider.
                  </p>
                  <p>
                    Shortcuts apply only while this page is focused. Global
                    desktop hotkeys and custom key bindings are unavailable.
                  </p>
                </>
              ) : dialog === "skin" ? (
                <>
                  <h3>AIMP Modern, browser adaptation</h3>
                  <p>
                    Inspired by memo-se’s Modern Advanced &amp; Basic skin.
                    BASIC maps native bands 2, 4, 6, 8, 9, 10, 12, 14, 16 and
                    18. The photographed Band 9 label is interpreted as 700 Hz;
                    the exact historical build and native filter curves remain
                    unverified.
                  </p>
                  <p>
                    Use ENH EQ for all 18 bands, or BASIC EQ to return. Native
                    OS window settings, alternative skins and language packs are
                    unavailable.
                  </p>
                </>
              ) : dialog === "limits" ? (
                <>
                  <p>
                    This browser edition keeps your audio local. These original
                    native features are not implemented:
                  </p>
                  <ul>
                    <li>
                      Radio capture, Open URL, tag editor and audio converter
                    </li>
                    <li>
                      Native DSP plugins, independent Pitch, TrueBass, Enhancer,
                      normalization, cross-mixing and silence removal
                    </li>
                    <li>
                      OS shutdown, stay-on-top, minimize/maximize and
                      application exit
                    </li>
                    <li>
                      Language packs, lyrics and cover-art panes, persistent
                      indexed library and multi-playlist management
                    </li>
                    <li>Folder import and playlist file import/export</li>
                  </ul>
                  <p>
                    Available counterparts: file info, session library/search,
                    A–B repeat, a playback sleep timer, and browser effects.
                    They do not claim native equivalence.
                  </p>
                </>
              ) : dialog === "library" ? (
                <>
                  <input
                    aria-label="Search library"
                    className="search"
                    placeholder="Search your music…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="library-list">
                    {tracks
                      .filter((t) =>
                        `${t.title} ${t.artist}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            select(tracks.indexOf(t));
                            setDialog(null);
                          }}
                        >
                          <span>
                            {t.title}
                            <small>
                              {t.artist} · {t.format} ·{" "}
                              {t.source === "demo"
                                ? "Original demo"
                                : "On this device"}
                            </small>
                          </span>
                          <time>{formatTime(t.duration)}</time>
                        </button>
                      ))}
                  </div>
                  <button
                    className="pill"
                    onClick={() => input.current?.click()}
                  >
                    ADD LOCAL MUSIC
                  </button>
                  <p>
                    All audio stays on your device. Files are available for this
                    session.
                  </p>
                </>
              ) : dialog === "clear" ? (
                <>
                  <p>
                    Remove all {tracks.length} tracks from this session? Your
                    original files will not be deleted.
                  </p>
                  <button
                    className="pill"
                    onClick={() => {
                      engine.stop();
                      urls.current.forEach(URL.revokeObjectURL);
                      urls.current = [];
                      setLoopA(null);
                      setLoopB(null);
                      loop.current = { a: null, b: null };
                      setTracks([]);
                      setCurrent(0);
                      setDuration(0);
                      setElapsed(0);
                      setDialog(null);
                    }}
                  >
                    CLEAR PLAYLIST
                  </button>
                </>
              ) : dialog === "help" ? (
                <>
                  <h3>Make yourself at home.</h3>
                  <p>
                    Press play to hear three original electronic demos, or drop
                    your own audio onto the player. Add multiple files with the
                    eject button.
                  </p>
                  <p>
                    Space plays or pauses. Select a playlist row to play it. The
                    seek bar, volume, stereo balance, 18-band equalizer and
                    browser effects control real audio. BASIC exposes ten of the
                    eighteen bands.
                  </p>
                  <p>
                    MP3 and WAV work in most browsers. FLAC, AAC/M4A, OGG and
                    Opus support depends on your browser. Protected/DRM files
                    and remote streaming services aren’t supported. Track names
                    come from filenames; embedded tags are not read.
                  </p>
                  <p>
                    Repeat loops the current track. Shuffle uses nonrepeating
                    playlist cycles; Previous retraces listening history. At the
                    end of the normal playlist, playback stops.
                  </p>
                  <p>
                    Preferences stay in this browser. Imported audio stays
                    private and is not retained after you refresh. High EQ
                    boosts may distort; lower the preamp to leave headroom.
                  </p>
                </>
              ) : (
                <>
                  <h3>AIMP MODERN · WEB EDITION</h3>
                  <p>
                    A loving browser recreation of the silver-and-blue desktop
                    audio era, inspired by the supplied AIMP Modern skin
                    reference.
                  </p>
                  <p>
                    Independent, unofficial project. Not affiliated with AIMP or
                    Winamp. All included demo music is originally synthesized
                    for this app. No accounts. No uploads. No tracking.
                  </p>
                  <p>Built with React, TypeScript and the Web Audio API.</p>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
