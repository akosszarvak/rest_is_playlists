// RSS fetching and parsing for The Rest Is History feed.
// Shared by scripts/fetch-rss.mjs (CLI) and the app's POST /api/episodes/refresh route.
// No dependencies: needs Node 20+ (uses the built-in fetch).

export const FEED_URL = "https://feeds.megaphone.fm/GLT4787413333";

const EPISODE_TYPES = new Set(["full", "trailer", "bonus"]);
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
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function toInt(s) {
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

/** Parses feed XML into episode objects, sorted by release date (oldest first). */
export function parseFeed(xml) {
  const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => chunk.split(/<\/item>/i)[0]);

  const episodes = items.map((item) => {
    const pubDate = tag(item, "pubDate");
    const date = pubDate ? new Date(pubDate) : null;
    const description = tag(item, "content:encoded") ?? tag(item, "description") ?? tag(item, "itunes:summary");
    const type = (tag(item, "itunes:episodeType") ?? "full").toLowerCase();
    return {
      guid: tag(item, "guid"),
      title: tag(item, "title"),
      releaseDate: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
      durationSec: toSeconds(tag(item, "itunes:duration")),
      episodeType: EPISODE_TYPES.has(type) ? type : "full",
      episodeNumber: toInt(tag(item, "itunes:episode")),
      season: toInt(tag(item, "itunes:season")),
      audioUrl: attr(item, "enclosure", "url"),
      description: stripHtml(description),
    };
  });

  episodes.sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""));
  return episodes;
}

/** Downloads the feed and returns the full `data/episodes.json` document. */
export async function fetchEpisodes(feedUrl = FEED_URL, { signal } = {}) {
  const res = await fetch(feedUrl, { headers: { "User-Agent": "rest-is-playlists/0.1" }, signal });
  if (!res.ok) throw new Error(`Feed request failed: ${res.status} ${res.statusText}`);
  const episodes = parseFeed(await res.text());
  return { source: feedUrl, fetchedAt: new Date().toISOString(), count: episodes.length, episodes };
}
