import { NextRequest, NextResponse } from 'next/server';
import teamsData from '../../data/nfl-teams.json';

type TeamMeta = {
  id: string;
  nickname: string;
  conference: 'AFC' | 'NFC';
  primaryHex: string;
  secondaryHex: string;
  crestUrl: string;
};

const TEAMS = teamsData as Record<string, TeamMeta>;

// Official NFL Division Map for Seeds 1–4 (Division Leaders) vs Seeds 5–7 (Wild Cards)
const DIVISION_MAP: Record<string, string> = {
  BUF: 'AFC_EAST', MIA: 'AFC_EAST', NE: 'AFC_EAST', NYJ: 'AFC_EAST',
  BAL: 'AFC_NORTH', CIN: 'AFC_NORTH', CLE: 'AFC_NORTH', PIT: 'AFC_NORTH',
  HOU: 'AFC_SOUTH', IND: 'AFC_SOUTH', JAX: 'AFC_SOUTH', TEN: 'AFC_SOUTH',
  DEN: 'AFC_WEST', KC: 'AFC_WEST', LAC: 'AFC_WEST', LV: 'AFC_WEST',
  DAL: 'NFC_EAST', NYG: 'NFC_EAST', PHI: 'NFC_EAST', WAS: 'NFC_EAST',
  CHI: 'NFC_NORTH', DET: 'NFC_NORTH', GB: 'NFC_NORTH', MIN: 'NFC_NORTH',
  ATL: 'NFC_SOUTH', CAR: 'NFC_SOUTH', NO: 'NFC_SOUTH', TB: 'NFC_SOUTH',
  ARI: 'NFC_WEST', LAR: 'NFC_WEST', SF: 'NFC_WEST', SEA: 'NFC_WEST'
};

interface TeamStanding {
  id: string;
  w: number;
  l: number;
  t: number;
  divW: number;
  divL: number;
  divT: number;
  confW: number;
  confL: number;
  confT: number;
  pf: number;
  pa: number;
  beatenOpponents: Set<string>;
}

// Normalise ESPN's 'WSH' abbreviation to match 'WAS' in nfl-teams.json
function normalizeTeamId(espnAbbr: string): string {
  if (espnAbbr === 'WSH') return 'WAS';
  return espnAbbr;
}

function calcPct(w: number, l: number, t: number): number {
  const total = w + l + t;
  if (total === 0) return 0;
  return (w + t * 0.5) / total;
}

// Official NFL Tiebreaker Comparator
function compareTeams(a: TeamStanding, b: TeamStanding, isSameDivision: boolean): number {
  // 1. Overall Win Percentage
  const pctA = calcPct(a.w, a.l, a.t);
  const pctB = calcPct(b.w, b.l, b.t);
  if (Math.abs(pctA - pctB) > 0.0001) return pctB - pctA;

  // 2. Head-to-Head
  const aBeatB = a.beatenOpponents.has(b.id);
  const bBeatA = b.beatenOpponents.has(a.id);
  if (aBeatB && !bBeatA) return -1;
  if (bBeatA && !aBeatB) return 1;

  // 3. Division Win Percentage (if in the same division)
  if (isSameDivision) {
    const divPctA = calcPct(a.divW, a.divL, a.divT);
    const divPctB = calcPct(b.divW, b.divL, b.divT);
    if (Math.abs(divPctA - divPctB) > 0.0001) return divPctB - divPctA;
  }

  // 4. Conference Win Percentage
  const confPctA = calcPct(a.confW, a.confL, a.confT);
  const confPctB = calcPct(b.confW, b.confL, b.confT);
  if (Math.abs(confPctA - confPctB) > 0.0001) return confPctB - confPctA;

  // 5. Net Points (Point Differential)
  const netA = a.pf - a.pa;
  const netB = b.pf - b.pa;
  if (netA !== netB) return netB - netA;

  // 6. Total Points Scored
  return b.pf - a.pf;
}

async function fetchWeekScoreboard(week: number) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}`;
  // Revalidate every 30 minutes so completed weeks are cached and live game days update automatically
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) return null;
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedWeekParam = searchParams.get('week');
  const confParam = (searchParams.get('conference') || 'AFC').toUpperCase();
  const conference: 'AFC' | 'NFC' = confParam === 'NFC' ? 'NFC' : 'AFC';

  try {
    // Fetch all 18 regular-season weeks in parallel (cached by Next.js)
    const weekNumbers = Array.from({ length: 18 }, (_, i) => i + 1);
    const allScoreboards = await Promise.all(weekNumbers.map((w) => fetchWeekScoreboard(w)));

    // Detect the highest week that has completed games
    let maxCompletedWeek = 1;
    allScoreboards.forEach((sb, idx) => {
      const wNum = idx + 1;
      const events = sb?.events || [];
      const hasCompletedGame = events.some(
        (ev: any) => ev?.competitions?.[0]?.status?.type?.completed === true
      );
      if (hasCompletedGame && wNum > maxCompletedWeek) {
        maxCompletedWeek = wNum;
      }
    });

    const targetWeek = requestedWeekParam
      ? Math.min(maxCompletedWeek, Math.max(1, Number(requestedWeekParam)))
      : maxCompletedWeek;

    // Initialise clean 0-0 records for all 32 teams
    const stats: Record<string, TeamStanding> = {};
    Object.keys(TEAMS).forEach((id) => {
      stats[id] = {
        id,
        w: 0, l: 0, t: 0,
        divW: 0, divL: 0, divT: 0,
        confW: 0, confL: 0, confT: 0,
        pf: 0, pa: 0,
        beatenOpponents: new Set<string>()
      };
    });

    // Tally every completed regular-season game from Week 1 up to targetWeek
    for (let w = 1; w <= targetWeek; w++) {
      const sb = allScoreboards[w - 1];
      const events = sb?.events || [];

      for (const ev of events) {
        const comp = ev?.competitions?.[0];
        if (!comp?.status?.type?.completed) continue;

        const competitors = comp.competitors || [];
        if (competitors.length < 2) continue;

        const c1 = competitors[0];
        const c2 = competitors[1];

        const id1 = normalizeTeamId(c1?.team?.abbreviation || '');
        const id2 = normalizeTeamId(c2?.team?.abbreviation || '');

        if (!stats[id1] || !stats[id2]) continue;

        const s1 = Number(c1.score || 0);
        const s2 = Number(c2.score || 0);

        stats[id1].pf += s1;
        stats[id1].pa += s2;
        stats[id2].pf += s2;
        stats[id2].pa += s1;

        const sameDiv = DIVISION_MAP[id1] === DIVISION_MAP[id2];
        const sameConf = TEAMS[id1].conference === TEAMS[id2].conference;

        if (s1 > s2) {
          stats[id1].w++;
          stats[id2].l++;
          stats[id1].beatenOpponents.add(id2);
          if (sameDiv) { stats[id1].divW++; stats[id2].divL++; }
          if (sameConf) { stats[id1].confW++; stats[id2].confL++; }
        } else if (s2 > s1) {
          stats[id2].w++;
          stats[id1].l++;
          stats[id2].beatenOpponents.add(id1);
          if (sameDiv) { stats[id2].divW++; stats[id1].divL++; }
          if (sameConf) { stats[id2].confW++; stats[id1].confL++; }
        } else {
          stats[id1].t++;
          stats[id2].t++;
          if (sameDiv) { stats[id1].divT++; stats[id2].divT++; }
          if (sameConf) { stats[id1].confT++; stats[id2].confT++; }
        }
      }
    }

    // Filter to the requested conference (16 teams)
    const confTeams = Object.values(stats).filter(
      (t) => TEAMS[t.id]?.conference === conference
    );

    // 1. Find the 4 Division Winners (East, North, South, West)
    const divisions = [`${conference}_EAST`, `${conference}_NORTH`, `${conference}_SOUTH`, `${conference}_WEST`];
    const divisionWinners: TeamStanding[] = [];
    const wildCardPool: TeamStanding[] = [];

    for (const div of divisions) {
      const divMembers = confTeams
        .filter((t) => DIVISION_MAP[t.id] === div)
        .sort((a, b) => compareTeams(a, b, true));

      if (divMembers.length > 0) {
        divisionWinners.push(divMembers[0]);
        wildCardPool.push(...divMembers.slice(1));
      }
    }

    // 2. Sort Seeds 1–4 (Division Leaders) & Seeds 5–7 (Top 3 Wild Cards)
    divisionWinners.sort((a, b) => compareTeams(a, b, false));
    wildCardPool.sort((a, b) => compareTeams(a, b, false));

    const top7 = [...divisionWinners, ...wildCardPool.slice(0, 3)];

    const standings = top7.map((entry, idx) => {
      const meta = TEAMS[entry.id];
      const record = entry.t > 0 ? `${entry.w}-${entry.l}-${entry.t}` : `${entry.w}-${entry.l}`;
      return {
        seed: idx + 1,
        id: meta.id,
        nickname: meta.nickname,
        conference: meta.conference,
        record,
        primaryHex: meta.primaryHex,
        secondaryHex: meta.secondaryHex,
        crestUrl: meta.crestUrl
      };
    });

    return NextResponse.json({
      week: targetWeek,
      maxCompletedWeek,
      conference,
      source: 'ESPN Live NFL Scoreboard API',
      standings
    });
  } catch (error) {
    console.error('Error computing live NFL standings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live NFL standings from ESPN' },
      { status: 500 }
    );
  }
}
