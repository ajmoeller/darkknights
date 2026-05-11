/**
 * BIHL Stats Scraper for Dark Knights
 * Run with: node scrape_stats.js
 * 
 * This script pulls down the current schedule, finds completed games,
 * looks up their box score pages, and parses out the goals scored 
 * by the Dark Knights.
 */

const TEAM_NAME = "Buccaneers Dark Knights";
const TEAM_ID = "672741";
const SCHEDULE_URL = "https://www.esportsdesk.com/leagues/schedules.cfm?clientid=6241&leagueID=28544&schedType=main&printPage=0";
const BOXSCORE_BASE = "https://www.esportsdesk.com/leagues/hockey_boxscores.cfm?clientID=6241&leagueID=28544&gameID=";
const PLAYER_ALIASES = {
  "Caleb Perry": "White Chocolate"
};

function displayPlayerName(name) {
  if (!name || typeof name !== 'string') return name;
  const normalized = name.replace(/^Mathew(\s+)/i, 'Mat$1');
  return PLAYER_ALIASES[normalized] || PLAYER_ALIASES[name] || normalized;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.text();
}

function parseSchedule(html) {
  // Regex to find game rows that involve Dark Knights
  // We'll just look for links to hockey_boxscores.cfm to find completed games
  const gameLinks = [...html.matchAll(/hockey_boxscores\.cfm\?clientID=\d+&leagueID=\d+&gameID=(\d+)/g)];
  // Filter for unique game IDs
  const uniqueIds = [...new Set(gameLinks.map(m => m[1]))];
  return uniqueIds;
}

function parseBoxScore(html, gameId) {
  // We want to find the SCORING SUMMARY section
  const summaryStart = html.indexOf("SCORING SUMMARY");
  if (summaryStart === -1) return null;
  const summaryEnd = html.indexOf("PENALTY SUMMARY", summaryStart);
  if (summaryEnd === -1) return null;
  
  const summaryHtml = html.slice(summaryStart, summaryEnd);
  
  // Extract periods and their goals
  const goals = [];
  const periodBlocks = summaryHtml.split(/(\d(?:ST|ND|RD) PERIOD|OT PERIOD)/);
  
  let currentPeriod = "1st";
  for (let i = 1; i < periodBlocks.length; i += 2) {
    const periodRaw = periodBlocks[i];
    if (periodRaw.includes("1ST")) currentPeriod = "1st";
    else if (periodRaw.includes("2ND")) currentPeriod = "2nd";
    else if (periodRaw.includes("3RD")) currentPeriod = "3rd";
    else if (periodRaw.includes("OT")) currentPeriod = "OT";
    
    const periodContent = periodBlocks[i+1];
    
    // We look for table rows that show the scoring details.
    // Example: 
    // #13 Aidan Atkins(7) Calen French, Jonah Hicks | 15:45 Buc 0, Buc 1
    // OR: #29 Calen French(6) Caleb Perry | SHG 8:06 Buc 2, Buc 6
    // We only want goals scored by TEAM_ID or TEAM_NAME. The easiest way is to look 
    // at the team name in the player profile link, or look for Dark Knights players.
    // But both teams might be "Buc", making it tricky. We can look for player teamID in the link.
    
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = [...periodContent.matchAll(rowRegex)];
    
    for (const rowMatch of rows) {
      const rowHtml = rowMatch[0];
      if (rowHtml.includes("No Scoring")) continue;
      
      // Look for the scorer's link to see if they are on our team
      // More tolerant regex to handle extra attributes on <a> tags and varying href order
      const scorerRegex = /#\d+\s+<a[^>]*teamID=(\d+)[^>]*>([^<]+)<\/a>/i;
      const scorerMatch = scorerRegex.exec(rowHtml);
      
      if (!scorerMatch) continue;
      const teamId = scorerMatch[1];
      const scorerName = displayPlayerName(scorerMatch[2]);
      
      if (teamId !== TEAM_ID) continue; // Not our team's goal
      
      // Parse assists (all remaining links in that td are assists usually)
      // Use the same tolerant pattern
      const allPlayerLinks = [...rowHtml.matchAll(/<a[^>]*teamID=\d+[^>]*>([^<]+)<\/a>/gi)];
      const assists = [];
      // skip the first one (scorer)
      for (let j = 1; j < allPlayerLinks.length; j++) {
        assists.push(displayPlayerName(allPlayerLinks[j][1]));
      }
      
      // Time and Badges are in the next td
      // Example: <td> PPG 10:03 Buc 2, Buc 5 </td>
      const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
      if (tds.length >= 2) {
        const timeCell = tds[1][1].replace(/<[^>]+>/g, '').trim();
        // Time cell might look like "PPG 10:03 Buc 2, Buc 5" or "16:35 Buc 2, Buc 4"
        const timeMatch = timeCell.match(/(?:([A-Z]{2,3})\s+)?(\d{1,2}:\d{2})\s/);
        
        let time = "";
        let badges = [];
        let scoreAtTime = "";
        if (timeMatch) {
          if (timeMatch[1]) badges.push(timeMatch[1]); // e.g. PPG, SHG, EN
          time = timeMatch[2];
        }
        
        // Extract score state at the time of goal, e.g. "Buc 2, Sta 1" or "Sta 1, Buc 0"
        const scoreMatch = timeCell.match(/([A-Za-z]{2,}\s+\d+)[,\s]+([A-Za-z]{2,}\s+\d+)$/);
        if (scoreMatch) {
          scoreAtTime = `${scoreMatch[1]}, ${scoreMatch[2]}`;
        }
        
        goals.push({
          period: currentPeriod,
          time: time,
          scorer: scorerName,
          assists: assists,
          badges: badges,
          scoreAtTime: scoreAtTime || undefined
        });
      }
    }
  }
  
  return goals;
}

async function run() {
  console.log("Fetching BIHL schedule...");
  try {
    const scheduleHtml = await fetchHtml(SCHEDULE_URL);
    const gameIds = parseSchedule(scheduleHtml);
    console.log(`Found ${gameIds.length} completed games with box scores.\n`);
    
    for (const gameId of gameIds) {
      console.log(`Fetching Box Score ID: ${gameId}...`);
      const boxHtml = await fetchHtml(BOXSCORE_BASE + gameId);
      const goals = parseBoxScore(boxHtml, gameId);
      
      if (goals && goals.length > 0) {
        console.log(`\nDark Knights Goals for Game ${gameId}:`);
        console.log("dkGoals: " + JSON.stringify(goals, null, 2) + ",\n");
      } else {
        console.log(`No Dark Knights goals found in Game ${gameId}.\n`);
      }
      // Be nice to the server
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log("---------------------------------------------------");
    console.log("AGENT INSTRUCTIONS FOR UPDATING:");
    console.log("1. Match the game ID dates/opponents with the games array in index.html.");
    console.log("2. Copy the outputted dkGoals blocks into the corresponding game object.");
    console.log("---------------------------------------------------");
    
  } catch (err) {
    console.error("Error scraping data:", err);
  }
}

run();