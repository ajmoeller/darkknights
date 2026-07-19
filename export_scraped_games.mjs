/**
 * Export scraped box score data as JSON keyed by gameId.
 * Run: node export_scraped_games.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const scrapePath = new URL("./scrape_stats.js", import.meta.url);

// scrape_stats is plain JS without exports; eval its functions via dynamic import workaround
const src = readFileSync(scrapePath, "utf8");
const fnBody = src.replace(/^run\(\);?\s*$/m, "");
const mod = {};
const wrapper = new Function(
  "exports",
  "fetch",
  `${fnBody}\nreturn { parseBoxScore, fetchHtml, BOXSCORE_BASE, KNOWN_DK_GAME_IDS, isDarkKnightsGame };`
);
const {
  parseBoxScore,
  fetchHtml,
  BOXSCORE_BASE,
  KNOWN_DK_GAME_IDS,
  isDarkKnightsGame,
} = wrapper(mod, fetch);

const GAME_ID_TO_DATE = {
  "2516393": "2026-03-22",
  "2516399": "2026-03-29",
  "2516410": "2026-04-19",
  "2516415": "2026-04-26",
  "2516422": "2026-05-03",
  "2516424": "2026-05-10",
  "2516434": "2026-05-17",
  "2516440": "2026-05-24",
  "2516448": "2026-06-07",
  "2516455": "2026-06-14",
  "2516462": "2026-06-21",
  "2516474": "2026-07-12",
  "2516479": "2026-07-19",
};

async function main() {
  const out = {};
  for (const gameId of KNOWN_DK_GAME_IDS) {
    const html = await fetchHtml(BOXSCORE_BASE + gameId);
    if (!isDarkKnightsGame(html)) continue;
    const { goals, boxScore } = parseBoxScore(html);
    out[gameId] = {
      date: GAME_ID_TO_DATE[gameId],
      gameId,
      boxScore,
      dkGoals: goals,
    };
    await new Promise((r) => setTimeout(r, 500));
  }
  writeFileSync(
    new URL("./scraped_games.json", import.meta.url),
    JSON.stringify(out, null, 2)
  );
  console.log(`Wrote ${Object.keys(out).length} games to scraped_games.json`);
}

main().catch(console.error);
