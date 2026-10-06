/**
 * Stable-ID playback navigation. Shuffle consumes every track once per cycle;
 * Previous/Next retrace actual history before choosing a new shuffled track.
 */
export class PlaybackSequence {
  private ids: string[] = [];
  private selected: string | null = null;
  private shuffle = false;
  private visited = new Set<string>();
  private history: string[] = [];
  private cursor = -1;

  constructor(private readonly random: () => number = Math.random) {}

  get currentId(): string | null {
    return this.selected;
  }

  /** Call with the full playlist and actual current track before navigating. */
  sync(
    ids: readonly string[],
    currentId: string | null,
    shuffle: boolean,
  ): void {
    this.ids = [
      ...new Set(ids.filter((id) => typeof id === "string" && id.length > 0)),
    ];
    const live = new Set(this.ids);
    this.visited = new Set([...this.visited].filter((id) => live.has(id)));
    const past = this.history
      .slice(0, this.cursor + 1)
      .filter((id) => live.has(id));
    const future = this.history
      .slice(this.cursor + 1)
      .filter((id) => live.has(id));
    this.history = [...past, ...future];
    this.cursor = past.length - 1;
    if (!live.has(this.selected ?? "")) this.selected = null;
    const current =
      currentId !== null && live.has(currentId) ? currentId : null;
    if (current !== this.selected) {
      if (current) this.record(current);
      else this.selected = null;
    }
    if (!this.ids.length) {
      this.history = [];
      this.cursor = -1;
      this.visited.clear();
    }
    if (shuffle !== this.shuffle) {
      this.shuffle = shuffle;
      this.visited = new Set(this.selected ? [this.selected] : []);
    }
  }

  /** Returns null at the end when playlist repeat is disabled. */
  next(repeatPlaylist = false): string | null {
    if (!this.ids.length) return null;
    if (this.shuffle && this.cursor < this.history.length - 1) {
      this.selected = this.history[++this.cursor];
      this.visited.add(this.selected);
      return this.selected;
    }
    if (!this.shuffle) {
      const index = this.selected ? this.ids.indexOf(this.selected) : -1;
      if (index === this.ids.length - 1 && !repeatPlaylist) return null;
      return this.record(this.ids[(index + 1) % this.ids.length]);
    }
    let candidates = this.ids.filter((id) => !this.visited.has(id));
    if (!candidates.length) {
      if (!repeatPlaylist) return null;
      this.visited.clear();
      // Avoid a duplicate at the cycle boundary when alternatives exist.
      candidates = this.ids.filter((id) => id !== this.selected);
      if (!candidates.length) candidates = [...this.ids];
    }
    const sample = this.random();
    const unit = Number.isFinite(sample)
      ? Math.max(0, Math.min(1 - Number.EPSILON, sample))
      : 0;
    return this.record(candidates[Math.floor(unit * candidates.length)]);
  }

  /** Shuffle goes back through playback history, never a newly randomized order. */
  previous(repeatPlaylist = false): string | null {
    if (!this.ids.length) return null;
    if (this.shuffle) {
      if (this.cursor <= 0) return null;
      this.selected = this.history[--this.cursor];
      return this.selected;
    }
    const index = this.selected ? this.ids.indexOf(this.selected) : -1;
    if (index <= 0 && !repeatPlaylist) return null;
    if (index < 0) return this.record(this.ids[this.ids.length - 1]);
    return this.record(
      this.ids[(index - 1 + this.ids.length) % this.ids.length],
    );
  }

  private record(id: string): string {
    this.selected = id;
    this.visited.add(id);
    if (this.history[this.cursor] !== id) {
      this.history = this.history.slice(0, this.cursor + 1);
      this.history.push(id);
      // Bound a long-running tab's history without disturbing the current cursor.
      if (this.history.length > 2048) this.history.shift();
      this.cursor = this.history.length - 1;
    }
    return id;
  }
}
