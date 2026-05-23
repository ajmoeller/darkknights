import { readFileSync, writeFileSync } from "fs";

const scraped = JSON.parse(
  readFileSync(new URL("./scraped_games.json", import.meta.url), "utf8")
);
const byDate = Object.fromEntries(
  Object.values(scraped).map((g) => [g.date, g])
);

const indexPath = new URL("./index.html", import.meta.url);
let html = readFileSync(indexPath, "utf8");
const match = html.match(/const games = (\[[\s\S]*?\n\]);/);
if (!match) throw new Error("Could not find games array in index.html");

const games = eval(match[1]);
let patched = 0;

for (const game of games) {
  const data = byDate[game.date];
  if (!data) continue;
  game.gameId = data.gameId;
  game.boxScore = data.boxScore;
  game.dkGoals = data.dkGoals;
  patched++;
}

const serialized = JSON.stringify(games, null, 2)
  .replace(/"([^"]+)":/g, "$1:")
  .replace(/"/g, '"');

html = html.replace(
  /const games = \[[\s\S]*?\n\];/,
  `const games = ${serialized};`
);
writeFileSync(indexPath, html);
console.log(`Patched ${patched} games in index.html`);
