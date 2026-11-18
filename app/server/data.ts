import { readFile } from "node:fs/promises";
import path from "node:path";
import { HOUSEHOLD_INFO, type FactorInfo } from "../src/model/catalogue.ts";

/** The subset of a metro file the server needs (places and signal labels). */
export interface MetroData {
  id: string;
  name: string;
  signals: { id: string; label: string; description: string }[];
  places: {
    id: string[];
    name: string[];
    signal: number[];
    confidence: number[];
    lon: number[];
    lat: number[];
  };
}

/**
 * Reads the same committed files the browser loads. Metro ids are checked against
 * index.json before any path is built, so a request can't read arbitrary files.
 */
export class DataStore {
  private readonly dir: string;
  private index: { metros: { id: string; name: string }[] } | null = null;
  private readonly metros = new Map<string, Promise<MetroData>>();

  constructor(dir: string) {
    this.dir = dir;
  }

  private async loadIndex() {
    if (!this.index) this.index = JSON.parse(await readFile(path.join(this.dir, "index.json"), "utf8"));
    return this.index!;
  }

  async has(id: string): Promise<boolean> {
    return (await this.loadIndex()).metros.some((m) => m.id === id);
  }

  async metro(id: string): Promise<MetroData> {
    if (!(await this.has(id))) throw new Error(`unknown metro ${id}`);
    let p = this.metros.get(id);
    if (!p) {
      p = readFile(path.join(this.dir, `${id}.json`), "utf8").then((t) => {
        const f = JSON.parse(t);
        return { id, name: f.metro.name, signals: f.signals, places: f.places } as MetroData;
      });
      this.metros.set(id, p);
    }
    return p;
  }

  /** Every factor the user can weight: the household factors plus the data's signals. */
  async catalogue(): Promise<FactorInfo[]> {
    const first = (await this.loadIndex()).metros[0].id;
    const m = await this.metro(first);
    return [...HOUSEHOLD_INFO, ...m.signals.map((s) => ({ id: s.id, label: s.label, description: s.description }))];
  }
}
