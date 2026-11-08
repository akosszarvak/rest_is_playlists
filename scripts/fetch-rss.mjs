#!/usr/bin/env node
// Fetches every episode of The Rest Is History from its public RSS feed and
// writes normalized metadata to data/episodes.json.
// No dependencies: needs Node 20+ (uses the built-in fetch).
// The app's "Refresh from RSS" button uses the same parser (scripts/lib/rss.mjs).
//
// Usage:  node scripts/fetch-rss.mjs [feedUrl]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEED_URL, fetchEpisodes } from "./lib/rss.mjs";

const feedUrl = process.argv[2] ?? FEED_URL;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data", "episodes.json");

async function main() {
  console.log(`Fetching ${feedUrl} ...`);
  const doc = await fetchEpisodes(feedUrl);
  const { episodes } = doc;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");

  console.log(`Wrote ${episodes.length} episodes to ${OUT}`);
  const missingGuid = episodes.filter((e) => !e.guid).length;
  if (missingGuid) console.warn(`Warning: ${missingGuid} episodes have no guid.`);
  if (episodes.length) {
    console.log(`Range: ${episodes[0].releaseDate} -> ${episodes.at(-1).releaseDate}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
