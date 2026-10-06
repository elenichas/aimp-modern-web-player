import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioEngine, createDemoTracks } from "./audio";
import {
  EQ_PRESETS,
  EQ_FREQUENCIES,
  formatTime,
  nextTrackIndex,
} from "./model";
import type { Track } from "./model";
import "./style.css";

import { defaults, parseSettings } from "./settings";
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
  const [eqVisible, setEqVisible] = useState(true);
  const [playlistVisible, setPlaylistVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("equalizer");
  const [dialog, setDialog] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState("Ready. Press play to begin.");
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState("Flat");
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useRef<string[]>([]);
  const state = useRef({ tracks, current, settings });
  state.current = { tracks, current, settings };
  const playRequest = useRef(0);
  const track = tracks[current];
  const update = (s: Partial<Settings>) => setSettings((v) => ({ ...v, ...s }));
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
    } catch {
      /* Storage may be unavailable in private mode. */
    }
    engine.setVolume(settings.volume);
    engine.setMuted(settings.muted);
    engine.setEQ(settings.gains, settings.preamp, settings.eq);
    engine.setBalance(settings.balance);
    engine.setEcho(settings.echo);
  }, [settings, engine]);
  const play = async () => {
    if (!state.current.tracks.length) {
      setNotice("Import audio files to start listening.");
      return;
    }
    const request = ++playRequest.current;
    try {
      await engine.play();
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
    setCurrent(index);
    setElapsed(0);
    const t = state.current.tracks[index];
    engine.load(t.url);
    setDuration(t.duration);
    if (autoplay) void play();
  };
  const advance = (direction = 1) => {
    const s = state.current;
    if (!s.tracks.length) return;
    select(
      direction < 0
        ? (s.current - 1 + s.tracks.length) % s.tracks.length
        : nextTrackIndex(s.current, s.tracks.length, s.settings.shuffle),
    );
  };
  useEffect(() => {
    if (tracks[0]) engine.load(tracks[0].url);
    const a = engine.audio;
    const time = () => setElapsed(a.currentTime);
    const metadata = () => {
      setDuration(Number.isFinite(a.duration) ? a.duration : 0);
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
      if (s.settings.repeat) {
        a.currentTime = 0;
        void play();
      } else if (s.settings.shuffle || s.current < s.tracks.length - 1)
        advance();
      else {
        setPlaying(false);
        a.currentTime = 0;
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
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag) || dialog)
        return;
      if (e.code === "Space") {
        e.preventDefault();
        playing ? engine.pause() : void play();
      }
      if (e.key === "Escape") {
        setMenu(null);
        setDialog(null);
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
    const p = EQ_PRESETS[name];
    if (p) {
      update({ gains: [...p.gains], preamp: p.preamp });
      setPreset(name);
    }
  };
  const menuActions: Record<string, { label: string; action: () => void }[]> = {
    File: [
      { label: "Add audio files…", action: () => input.current?.click() },
      { label: "Music library", action: () => setDialog("library") },
      { label: "Clear playlist", action: () => setDialog("clear") },
    ],
    Play: [
      {
        label: playing ? "Pause" : "Play",
        action: () => (playing ? engine.pause() : void play()),
      },
      { label: "Stop", action: () => engine.stop() },
      { label: "Next track", action: () => advance() },
      {
        label: `${settings.shuffle ? "✓ " : ""}Shuffle`,
        action: () => update({ shuffle: !settings.shuffle }),
      },
      {
        label: `${settings.repeat ? "✓ " : ""}Repeat current track`,
        action: () => update({ repeat: !settings.repeat }),
      },
    ],
    Options: [
      {
        label: "Equalizer presets",
        action: () => {
          setEqVisible(true);
          setTab("equalizer");
          setDialog("presets");
        },
      },
      {
        label: "Audio effects",
        action: () => {
          setEqVisible(true);
          setTab("effect");
        },
      },
      {
        label: "Player settings",
        action: () => {
          setEqVisible(true);
          setTab("settings");
        },
      },
    ],
    View: [
      {
        label: `${eqVisible ? "✓ " : ""}Equalizer`,
        action: () => setEqVisible(!eqVisible),
      },
      {
        label: `${playlistVisible ? "✓ " : ""}Playlist`,
        action: () => setPlaylistVisible(!playlistVisible),
      },
      { label: "Compact player", action: () => setCollapsed(!collapsed) },
    ],
    Help: [
      { label: "Using Modern", action: () => setDialog("help") },
      { label: "About this player", action: () => setDialog("about") },
    ],
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
            <span className="tiny-logo">◩</span>
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
                        <small>MODE</small>
                        <b>LOCAL</b>
                      </div>
                      <div>
                        <b>STEREO</b>
                        <b>{track?.format || "—"}</b>
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
                            : (engine.stop(), setElapsed(0))
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
                setEqVisible(!eqVisible);
                setTab("equalizer");
              }}
              aria-label="Toggle configuration"
              aria-pressed={eqVisible}
            >
              CONFIG<span className="logo-mark">△</span>
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
                      ? "BASIC"
                      : tab === "effect"
                        ? "DSP EFFECTS"
                        : "PREFERENCES"}
                  </span>
                </h2>
                <div className="response">
                  <span>
                    +12 dB
                    <br />0 dB
                    <br />
                    −12 dB
                  </span>
                  <svg
                    viewBox="0 0 300 35"
                    preserveAspectRatio="none"
                    aria-label="Equalizer response"
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
                      points={settings.gains
                        .map((v, i) => `${(i * 300) / 9},${17.5 - v}`)
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
                      aria-label="Stereo pan"
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
                        onClick={() => setDialog("presets")}
                      >
                        PRESETS
                      </button>
                      <button
                        className="pill"
                        onClick={() => applyPreset("Flat")}
                      >
                        RESET EQ
                      </button>
                    </div>
                  </div>
                  <div className={`faders ${settings.eq ? "" : "bypassed"}`}>
                    <div className="fader preamp">
                      <input
                        aria-label="Preamp"
                        type="range"
                        min="-12"
                        max="12"
                        step=".5"
                        value={settings.preamp}
                        onChange={(e) => {
                          update({ preamp: Number(e.target.value) });
                          setPreset("Custom");
                        }}
                      />
                      <span>PREAMP</span>
                    </div>
                    <div className="db-scale">
                      <span>+12</span>
                      <span>0 dB</span>
                      <span>−12</span>
                    </div>
                    {EQ_FREQUENCIES.map((hz, i) => (
                      <div className="fader" key={hz}>
                        <input
                          aria-label={`${hz} Hz`}
                          title={`${hz} Hz: ${settings.gains[i]} dB`}
                          type="range"
                          min="-12"
                          max="12"
                          step=".5"
                          value={settings.gains[i]}
                          onChange={(e) => {
                            const gains = [...settings.gains];
                            gains[i] = Number(e.target.value);
                            update({ gains });
                            setPreset("Custom");
                          }}
                        />
                        <span>{hz >= 1000 ? `${hz / 1000}K` : hz}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : tab === "effect" ? (
                <div className="other-settings">
                  <div>
                    <h3>STEREO ECHO</h3>
                    <p>
                      A little space for your sound. A real feedback delay,
                      processed on your device.
                    </p>
                    <label>
                      Dry
                      <input
                        aria-label="Echo amount"
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={settings.echo}
                        onChange={(e) =>
                          update({ echo: Number(e.target.value) })
                        }
                      />
                      Wet <output>{Math.round(settings.echo * 100)}%</output>
                    </label>
                  </div>
                  <button
                    className="pill"
                    onClick={() => update({ echo: 0, balance: 0 })}
                  >
                    RESET EFFECTS
                  </button>
                </div>
              ) : (
                <div className="other-settings settings-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.visual}
                      onChange={(e) => update({ visual: e.target.checked })}
                    />{" "}
                    Live spectrum visualization
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.repeat}
                      onChange={(e) => update({ repeat: e.target.checked })}
                    />{" "}
                    Repeat current track
                  </label>
                  <p>
                    Audio preferences are saved in this browser. Local files are
                    never uploaded and must be re-added after a refresh.
                  </p>
                  <button
                    className="pill"
                    onClick={() => {
                      setSettings({ ...defaults });
                      setPreset("Flat");
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
              <h2>
                {dialog === "presets"
                  ? "EQUALIZER PRESETS"
                  : dialog === "library"
                    ? "MUSIC LIBRARY"
                    : dialog === "help"
                      ? "USING MODERN"
                      : dialog === "clear"
                        ? "CLEAR PLAYLIST"
                        : "ABOUT MODERN"}
              </h2>
              <button
                aria-label="Close dialog"
                autoFocus
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </header>
            <div className="modal-content">
              {dialog === "presets" ? (
                <>
                  <p>Find your frequency. Current: {preset}</p>
                  <div className="preset-grid">
                    {Object.keys(EQ_PRESETS).map((name) => (
                      <button
                        className={`pill ${preset === name ? "active" : ""}`}
                        key={name}
                        onClick={() => {
                          applyPreset(name);
                          setDialog(null);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
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
                    seek bar, volume, stereo pan, 10-band equalizer and echo
                    effect control real audio.
                  </p>
                  <p>
                    MP3 and WAV work in most browsers. FLAC, AAC/M4A, OGG and
                    Opus support depends on your browser. Protected/DRM files
                    and remote streaming services aren’t supported. Track names
                    come from filenames; embedded tags are not read.
                  </p>
                  <p>
                    Repeat loops the current track. Shuffle chooses a different
                    track when possible. At the end of the normal playlist,
                    playback stops.
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
