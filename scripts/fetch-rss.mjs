#!/usr/bin/env node
// Fetches every episode of The Rest Is History from its public RSS feed and
// writes normalized metadata to data/episodes.json.
// No dependencies: needs Node 20+ (uses the built-in fetch).
//
// Usage:  node scripts/fetch-rss.mjs [feedUrl]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FEED_URL = process.argv[2] ?? "https://feeds.megaphone.fm/GLT4787413333";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data", "episodes.json");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function unwrap(raw) {
  if (raw == null) return null;
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  return m ? unwrap(m[1]).trim() : null;
}

function attr(xml, name, attribute) {
  const re = new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function stripHtml(html) {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toSeconds(d) {
  if (!d) return null;
  if (/^\d+$/.test(d)) return Number(d);
  const parts = d.split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

async function main() {
  console.log(`Fetching ${FEED_URL} ...`);
  const res = await fetch(FEED_URL, { headers: { "User-Agent": "rest-is-playlists/0.1" } });
  if (!res.ok) throw new Error(`Feed request failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => chunk.split(/<\/item>/i)[0]);

  const episodes = items.map((item) => {
    const pubDate = tag(item, "pubDate");
    const description = tag(item, "content:encoded") ?? tag(item, "description") ?? tag(item, "itunes:summary");
    return {
      guid: tag(item, "guid"),
      title: tag(item, "title"),
      releaseDate: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
      durationSec: toSeconds(tag(item, "itunes:duration")),
      episodeType: tag(item, "itunes:episodeType") ?? "full",
      episodeNumber: tag(item, "itunes:episode") ? Number(tag(item, "itunes:episode")) : null,
      season: tag(item, "itunes:season") ? Number(tag(item, "itunes:season")) : null,
      audioUrl: attr(item, "enclosure", "url"),
      description: stripHtml(description),
    };
  });

  episodes.sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""));

  const missingGuid = episodes.filter((e) => !e.guid).length;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ source: FEED_URL, fetchedAt: new Date().toISOString(), count: episodes.length, episodes }, null, 2) + "\n",
    "utf8"
  );

  console.log(`Wrote ${episodes.length} episodes to ${OUT}`);
  if (missingGuid) console.warn(`Warning: ${missingGuid} episodes have no guid.`);
  if (episodes.length) {
    console.log(`Range: ${episodes[0].releaseDate} -> ${episodes.at(-1).releaseDate}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
