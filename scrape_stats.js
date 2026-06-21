/**
 * BIHL Stats Scraper for Dark Knights
 * Run with: node scrape_stats.js
 *
 * Pulls completed Dark Knights box scores: period scoring, team details
 * (SOG / PP / PIM), and Dark Knights goals from the scoring summary.
 */

const TEAM_NAME = "Buccaneers Dark Knights";
const TEAM_ID = "672741";
const SCHEDULE_URL =
  "https://www.esportsdesk.com/leagues/schedules.cfm?clientid=6241&leagueID=28544&schedType=main&printPage=0";
const BOXSCORE_BASE =
  "https://www.esportsdesk.com/leagues/hockey_boxscores.cfm?clientID=6241&leagueID=28544&gameID=";
/** Discovered Dark Knights box score IDs (schedule link scan can miss some). */
const KNOWN_DK_GAME_IDS = [
  "2516393",
  "2516399",
  "2516410",
  "2516415",
  "2516422",
  "2516424",
  "2516434",
  "2516440",
  "2516448",
  "2516455",
  "2516462",
];
const PLAYER_ALIASES = {
  "Caleb Perry": "White Chocolate",
};

function displayPlayerName(name) {
  if (!name || typeof name !== "string") return name;
  const normalized = name.replace(/^Mathew(\s+)/i, "Mat$1");
  return PLAYER_ALIASES[normalized] || PLAYER_ALIASES[name] || normalized;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.text();
}

function parseSchedule(html) {
  const gameLinks = [
    ...html.matchAll(
      /hockey_boxscores\.cfm\?clientID=\d+&leagueID=\d+&gameID=(\d+)/gi
    ),
  ];
  return [...new Set(gameLinks.map((m) => m[1]))];
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function teamNameFromRow(rowHtml) {
  const title = rowHtml.match(/title="([^"]+)"/);
  if (title) return title[1];
  const linkText = rowHtml.match(/target="_parent">([^<]+)</);
  return linkText ? linkText[1].trim() : "Unknown";
}

function parseStatsTable(sectionHtml) {
  const tbody = sectionHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return [];

  const rows = [];
  for (const rowMatch of tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const teamIdMatch = rowHtml.match(/teamID=(\d+)/i);
    if (!teamIdMatch) continue;

    const cells = [
      ...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((c) => stripTags(c[1]));

    rows.push({
      teamId: teamIdMatch[1],
      name: teamNameFromRow(rowHtml),
      cells,
    });
  }
  return rows;
}

function parseScoringAndDetails(html) {
  const scoringStart = html.indexOf("<strong>SCORING</strong>");
  const detailsStart = html.indexOf("<strong>DETAILS</strong>");
  const summaryStart = html.indexOf("<strong>SCORING SUMMARY</strong>");
  if (scoringStart === -1 || detailsStart === -1 || summaryStart === -1) {
    return null;
  }

  const scoringRows = parseStatsTable(
    html.slice(scoringStart, detailsStart)
  );
  const detailsRows = parseStatsTable(html.slice(detailsStart, summaryStart));

  const teams = scoringRows.map((row) => {
    const periodScores = row.cells
      .slice(1)
      .map((v) => parseInt(v, 10))
      .filter((n) => !Number.isNaN(n));
    const total = periodScores.length
      ? periodScores[periodScores.length - 1]
      : null;
    const periods =
      periodScores.length > 1 ? periodScores.slice(0, -1) : periodScores;

    const details = detailsRows.find((d) => d.teamId === row.teamId);
    const detailCells = details ? details.cells.slice(1) : [];

    return {
      teamId: row.teamId,
      name: row.name,
      periods,
      total,
      sog: detailCells[0] || "",
      pp: detailCells[1] || "",
      pim: detailCells[2] ? parseInt(detailCells[2], 10) : null,
      isDarkKnights: row.teamId === TEAM_ID,
    };
  });

  return { teams };
}

function parseGoalRows(summaryHtml) {
  const goals = [];
  const periodBlocks = summaryHtml.split(
    /(\d(?:ST|ND|RD)\s*PERIOD|OT\s*PERIOD|SO\s*PERIOD)/i
  );

  let currentPeriod = "1st";
  for (let i = 1; i < periodBlocks.length; i += 2) {
    const periodRaw = periodBlocks[i];
    if (/1ST/i.test(periodRaw)) currentPeriod = "1st";
    else if (/2ND/i.test(periodRaw)) currentPeriod = "2nd";
    else if (/3RD/i.test(periodRaw)) currentPeriod = "3rd";
    else if (/OT/i.test(periodRaw)) currentPeriod = "OT";
    else if (/SO/i.test(periodRaw)) currentPeriod = "SO";

    const periodContent = periodBlocks[i + 1] || "";
    for (const rowMatch of periodContent.matchAll(
      /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    )) {
      const rowHtml = rowMatch[1];
      if (/No Scoring/i.test(rowHtml)) continue;

      const playerLinks = [
        ...rowHtml.matchAll(
          /<a[^>]*teamID=(\d+)[^>]*title="([^"]+)"[^>]*>/gi
        ),
      ];
      if (!playerLinks.length) continue;

      const scorerTeamId = playerLinks[0][1];
      if (scorerTeamId !== TEAM_ID) continue;

      const scorerName = displayPlayerName(playerLinks[0][2]);
      const assists = playerLinks
        .slice(1)
        .filter((link) => link[1] === TEAM_ID)
        .map((link) => displayPlayerName(link[2]));

      const timeCell = rowHtml.match(
        /<td[^>]*align="right"[^>]*>([\s\S]*?)<\/td>/i
      );
      let time = "";
      let badges = [];
      let scoreAtTime = "";

      if (timeCell) {
        const timeText = stripTags(timeCell[1]);
        const badgeMatches = [
          ...timeCell[1].matchAll(
            /<span[^>]*>\s*([A-Z0-9]{2,4})\s*<\/span>/gi
          ),
        ];
        badges = badgeMatches
          .map((m) => m[1])
          .filter((b) => b !== timeText.match(/\d{1,2}:\d{2}/)?.[0]);

        const timeMatch = timeText.match(/(\d{1,2}:\d{2})/);
        if (timeMatch) time = timeMatch[1];

        const knownBadges = ["PPG", "SHG", "EN", "3v5", "4v4", "5v4"];
        badges = [
          ...new Set([
            ...badges.filter((b) => knownBadges.includes(b)),
            ...(timeText.match(/\b(PPG|SHG|EN|3v5|4v4|5v4)\b/g) || []),
          ]),
        ];

        const scoreMatch = timeText.match(
          /([A-Za-z]{2,}\s+\d+)[,\s]+([A-Za-z]{2,}\s+\d+)/
        );
        if (scoreMatch) {
          scoreAtTime = `${scoreMatch[1]}, ${scoreMatch[2]}`;
        }
      }

      goals.push({
        period: currentPeriod,
        time,
        scorer: scorerName,
        assists,
        badges,
        scoreAtTime: scoreAtTime || undefined,
      });
    }
  }

  return goals;
}

function parseBoxScore(html) {
  const boxScore = parseScoringAndDetails(html);

  const summaryStart = html.indexOf("SCORING SUMMARY");
  if (summaryStart === -1) {
    return { goals: [], boxScore };
  }
  const summaryEnd = html.indexOf("PENALTY SUMMARY", summaryStart);
  const summaryHtml = html.slice(
    summaryStart,
    summaryEnd === -1 ? undefined : summaryEnd
  );
  const goals = parseGoalRows(summaryHtml);

  return { goals, boxScore };
}

function isDarkKnightsGame(html) {
  return html.includes(`teamID=${TEAM_ID}`);
}

async function run() {
  console.log("Fetching BIHL schedule...");
  try {
    const scheduleHtml = await fetchHtml(SCHEDULE_URL);
    const scheduleIds = parseSchedule(scheduleHtml);
    const gameIds = [...new Set([...KNOWN_DK_GAME_IDS, ...scheduleIds])].sort();
    console.log(`Scraping ${gameIds.length} candidate Dark Knights box scores...\n`);

    for (const gameId of gameIds) {
      console.log(`Fetching Box Score ID: ${gameId}...`);
      const boxHtml = await fetchHtml(BOXSCORE_BASE + gameId);
      if (!isDarkKnightsGame(boxHtml)) {
        continue;
      }

      const { goals, boxScore } = parseBoxScore(boxHtml);

      console.log(`\n=== Game ${gameId} ===`);
      if (boxScore) {
        console.log("boxScore: " + JSON.stringify(boxScore, null, 2) + ",");
      }
      if (goals.length > 0) {
        console.log("dkGoals: " + JSON.stringify(goals, null, 2) + ",");
      } else {
        console.log("dkGoals: (none),");
      }
      console.log("");

      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("---------------------------------------------------");
    console.log("AGENT INSTRUCTIONS FOR UPDATING:");
    console.log("1. Match game IDs to dates/opponents in index.html games array.");
    console.log("2. Copy boxScore and dkGoals into the matching game object.");
    console.log("3. Optional: add gameId field for easier future scrapes.");
    console.log("---------------------------------------------------");
  } catch (err) {
    console.error("Error scraping data:", err);
  }
}

run();
