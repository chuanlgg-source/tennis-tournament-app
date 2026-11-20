/**
 * CourtFlow Tennis Doubles Tournament Engine (Pure JS, UMD-compatible)
 * Handles:
 *  - Skill tier presets & custom weights
 *  - Doubles pairing with gender/skill balancing & mixed-overflow handling
 *  - Tournament bracket generation (with ITF/KTA standard BYE placement & auto-advance)
 *  - Individual (KDK-style partner rotation) doubles scheduling with odd-player fairness
 *  - Group (Team match) snake-draft balancing, optimal game count recommendation, & captain lineups
 *  - Event (Ad-hoc / Random / Tiebreak) match generation
 *  - Incident management (sudden withdrawal, substitution, walkover, rematch)
 *  - Official scoring & tie-breakers: Win +1, Draw 0, Loss -1; Tie-breaker: Total Score -> Diff -> Wins
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TennisEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SKILL_PRESETS = {
    abcde: {
      id: 'abcde',
      name: '동호인 등급 (A ~ E)',
      levels: [
        { code: 'A', label: 'A (최상급)', weight: 5 },
        { code: 'B', label: 'B (상급)', weight: 4 },
        { code: 'C', label: 'C (중급)', weight: 3 },
        { code: 'D', label: 'D (초중급)', weight: 2 },
        { code: 'E', label: 'E (입문/초급)', weight: 1 },
      ],
    },
    ntrp: {
      id: 'ntrp',
      name: 'NTRP (2.0 ~ 5.0)',
      levels: [
        { code: '5.0', label: 'NTRP 5.0', weight: 7 },
        { code: '4.5', label: 'NTRP 4.5', weight: 6 },
        { code: '4.0', label: 'NTRP 4.0', weight: 5 },
        { code: '3.5', label: 'NTRP 3.5', weight: 4 },
        { code: '3.0', label: 'NTRP 3.0', weight: 3 },
        { code: '2.5', label: 'NTRP 2.5', weight: 2 },
        { code: '2.0', label: 'NTRP 2.0', weight: 1 },
      ],
    },
    medal: {
      id: 'medal',
      name: '금·은·동·신인배',
      levels: [
        { code: '금배', label: '금배 (오픈)', weight: 4 },
        { code: '은배', label: '은배 (상급)', weight: 3 },
        { code: '동배', label: '동배 (중급)', weight: 2 },
        { code: '신인', label: '신인부 (초급)', weight: 1 },
      ],
    },
  };

  const MATCH_FORMATS = {
    '6game-noad': { id: '6game-noad', label: '6게임 1세트 (노애드, 5:5 타이브레이크)', targetScore: 6, allowDraw: false, walkoverScore: 6 },
    '6game-draw': { id: '6game-draw', label: '6게임 1세트 (노애드, 5:5 무승부)', targetScore: 6, allowDraw: true, walkoverScore: 6 },
    '4game-noad': { id: '4game-noad', label: '4게임 단축세트 (노애드, 3:3 타이브레이크)', targetScore: 4, allowDraw: false, walkoverScore: 4 },
    '4game-draw': { id: '4game-draw', label: '4게임 단축세트 (노애드, 3:3 무승부)', targetScore: 4, allowDraw: true, walkoverScore: 4 },
    '8game-pro': { id: '8game-pro', label: '8게임 프로세트 (7:7 타이브레이크)', targetScore: 8, allowDraw: false, walkoverScore: 8 },
    'tb-7': { id: 'tb-7', label: '7점 타이브레이크 이벤트', targetScore: 7, allowDraw: false, walkoverScore: 7 },
    'tb-10': { id: 'tb-10', label: '10점 슈퍼타이브레이크 이벤트', targetScore: 10, allowDraw: false, walkoverScore: 10 },
    'one-point': { id: 'one-point', label: '원포인트 (1점 서든데스)', targetScore: 1, allowDraw: false, walkoverScore: 1 },
  };

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36).slice(-4);
  }

  function getSkillWeight(skillCode, levels) {
    if (!levels || !levels.length) return 3;
    const found = levels.find((l) => String(l.code).toUpperCase() === String(skillCode).toUpperCase());
    if (found) return Number(found.weight) || 1;
    // Fallback numeric parse (e.g. NTRP 3.5)
    const num = parseFloat(skillCode);
    if (!isNaN(num)) return num;
    return 1;
  }

  function normalizeGender(val) {
    const s = String(val || '').trim().toUpperCase();
    if (['M', 'MALE', '남', '남성', '남자', 'MAN'].includes(s)) return 'M';
    if (['F', 'FEMALE', '여', '여성', '여자', 'WOMAN', 'W'].includes(s)) return 'F';
    return 'M';
  }

  function genderLabel(g) {
    return g === 'F' ? '여성' : '남성';
  }

  function teamTypeLabel(t) {
    if (t === 'men') return '남성복식';
    if (t === 'women') return '여성복식';
    if (t === 'mixed') return '혼성복식';
    return '자유복식';
  }

  function getActivePlayers(players) {
    return (players || []).filter((p) => p.status !== 'withdrawn');
  }

  /**
   * Pair players into Doubles Teams according to teamMode ('men' | 'women' | 'mixed')
   * and pairingStrategy ('balanced' | 'similar').
   * Flexibly handles odd counts & gender imbalance without crashing:
   * - If teamMode is 'men' or 'women', pairs matching gender first; if unmatched players remain
   *   and opposite gender players exist in the pool, creates flexible 'mixed-overflow' teams and logs warnings.
   * - If an odd 1 player remains overall, returns them in `unpaired` with actionable notice.
   */
  function buildDoublesTeams(players, options) {
    const opts = Object.assign({
      teamMode: 'mixed', // 'men' | 'women' | 'mixed'
      pairingStrategy: 'balanced', // 'balanced' (high+low) | 'similar' (high+high)
      levels: SKILL_PRESETS.abcde.levels,
      allowMixedOverflow: true,
    }, options || {});

    const active = getActivePlayers(players).map((p) => ({
      ...p,
      _w: getSkillWeight(p.skill, opts.levels),
    }));

    const men = active.filter((p) => p.gender === 'M').sort((a, b) => b._w - a._w);
    const women = active.filter((p) => p.gender === 'F').sort((a, b) => b._w - a._w);

    const teams = [];
    const warnings = [];
    const leftovers = [];

    function pairSameList(list, divisionTag, strategy) {
      const arr = list.slice();
      while (arr.length >= 2) {
        let p1, p2;
        if (strategy === 'balanced') {
          p1 = arr.shift(); // strongest
          p2 = arr.pop();   // weakest
        } else {
          p1 = arr.shift();
          p2 = arr.shift();
        }
        teams.push(makeTeam(p1, p2, divisionTag, false));
      }
      return arr; // 0 or 1 leftover
    }

    function makeTeam(p1, p2, division, isOverflow) {
      const actualDiv =
        p1.gender === 'M' && p2.gender === 'M'
          ? 'men'
          : p1.gender === 'F' && p2.gender === 'F'
          ? 'women'
          : 'mixed';
      return {
        id: uid('team'),
        name: `${p1.name} / ${p2.name}`,
        players: [p1.id, p2.id],
        playerDetails: [
          { id: p1.id, name: p1.name, gender: p1.gender, skill: p1.skill, weight: p1._w },
          { id: p2.id, name: p2.name, gender: p2.gender, skill: p2.skill, weight: p2._w },
        ],
        division: actualDiv,
        requestedDivision: division,
        isMixedOverflow: Boolean(isOverflow),
        avgWeight: Number(((p1._w + p2._w) / 2).toFixed(2)),
        totalWeight: p1._w + p2._w,
      };
    }

    if (opts.teamMode === 'men') {
      const remM = pairSameList(men, 'men', opts.pairingStrategy);
      let remW = women.slice();
      if (remW.length > 0) {
        warnings.push(`남성복식 설정이지만 여성 참가자 ${remW.length}명이 포함되어 있습니다.`);
      }
      if (opts.allowMixedOverflow && remM.length === 1 && remW.length >= 1) {
        // Pick woman closest to balanced average
        const wPick = remW.shift();
        teams.push(makeTeam(remM.pop(), wPick, 'men', true));
        warnings.push(`남성 인원 홀수로 인해 잔여 남성 1명과 여성 1명을 [혼성 보정팀]으로 유연 편성했습니다.`);
      }
      if (opts.allowMixedOverflow && remW.length >= 2) {
        remW = pairSameList(remW, 'women', opts.pairingStrategy);
        warnings.push(`잔여 여성 인원을 여성복식 팀으로 추가 편성했습니다.`);
      }
      leftovers.push(...remM, ...remW);
    } else if (opts.teamMode === 'women') {
      const remW = pairSameList(women, 'women', opts.pairingStrategy);
      let remM = men.slice();
      if (remM.length > 0) {
        warnings.push(`여성복식 설정이지만 남성 참가자 ${remM.length}명이 포함되어 있습니다.`);
      }
      if (opts.allowMixedOverflow && remW.length === 1 && remM.length >= 1) {
        const mPick = remM.shift();
        teams.push(makeTeam(remW.pop(), mPick, 'women', true));
        warnings.push(`여성 인원 홀수로 인해 잔여 여성 1명과 남성 1명을 [혼성 보정팀]으로 유연 편성했습니다.`);
      }
      if (opts.allowMixedOverflow && remM.length >= 2) {
        remM = pairSameList(remM, 'men', opts.pairingStrategy);
        warnings.push(`잔여 남성 인원을 남성복식 팀으로 추가 편성했습니다.`);
      }
      leftovers.push(...remW, ...remM);
    } else {
      // Mixed mode: pair M + F first
      const mArr = men.slice();
      const wArr = women.slice();
      const mixCount = Math.min(mArr.length, wArr.length);
      for (let i = 0; i < mixCount; i++) {
        let m, w;
        if (opts.pairingStrategy === 'balanced') {
          m = mArr.shift(); // strongest M
          w = wArr.pop();   // weakest F
        } else {
          m = mArr.shift();
          w = wArr.shift();
        }
        teams.push(makeTeam(m, w, 'mixed', false));
      }
      // Remaining same-gender players
      if (mArr.length >= 2) {
        const remM = pairSameList(mArr, 'mixed', opts.pairingStrategy);
        warnings.push(`남성 인원이 여성보다 많아 잔여 남성으로 남성복식 보정팀을 편성했습니다.`);
        leftovers.push(...remM);
      } else {
        leftovers.push(...mArr);
      }
      if (wArr.length >= 2) {
        const remW = pairSameList(wArr, 'mixed', opts.pairingStrategy);
        warnings.push(`여성 인원이 남성보다 많아 잔여 여성으로 여성복식 보정팀을 편성했습니다.`);
        leftovers.push(...remW);
      } else {
        leftovers.push(...wArr);
      }
    }

    if (leftovers.length > 0) {
      warnings.push(
        `전체 인원이 홀수(${active.length}명)여서 ${leftovers.map((p) => p.name).join(', ')} 선수가 대기(예비/교체) 인원으로 분류되었습니다.`
      );
    }

    return { teams, leftovers, warnings };
  }

  /**
   * Partition items (teams or players) into `groupCount` groups.
   * mode: 'skill-tier' (group by skill level: Group A = strongest, Group B = next...)
   *    or 'balanced' (snake-draft so all groups have equal skill & gender distribution)
   */
  function allocateIntoGroups(items, groupCount, mode, getWeightFn, getGenderFn) {
    const count = Math.max(1, Math.min(Number(groupCount) || 1, Math.max(1, items.length)));
    const groupNames = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const groups = Array.from({ length: count }, (_, idx) => ({
      id: uid('grp'),
      name: `${groupNames[idx] || (idx + 1)}조`,
      index: idx,
      items: [],
    }));

    if (items.length === 0) return groups;

    const sorted = items.slice().sort((a, b) => {
      const wa = getWeightFn(a);
      const wb = getWeightFn(b);
      if (wb !== wa) return wb - wa;
      const ga = getGenderFn ? getGenderFn(a) : '';
      const gb = getGenderFn ? getGenderFn(b) : '';
      return ga.localeCompare(gb);
    });

    if (mode === 'skill-tier') {
      // Split sorted list into contiguous skill-level buckets
      const baseSize = Math.floor(sorted.length / count);
      const remainder = sorted.length % count;
      let cursor = 0;
      for (let g = 0; g < count; g++) {
        const sz = baseSize + (g < remainder ? 1 : 0);
        groups[g].items = sorted.slice(cursor, cursor + sz);
        cursor += sz;
      }
    } else {
      // Snake draft: 0..count-1, then count-1..0
      // Separate by gender first if getGenderFn provided so gender ratio is balanced too
      if (getGenderFn) {
        const men = sorted.filter((x) => getGenderFn(x) === 'M');
        const women = sorted.filter((x) => getGenderFn(x) === 'F');
        const others = sorted.filter((x) => getGenderFn(x) !== 'M' && getGenderFn(x) !== 'F');
        const ordered = [...men, ...women, ...others];
        ordered.forEach((item, idx) => {
          const round = Math.floor(idx / count);
          const pos = idx % count;
          const targetIdx = round % 2 === 0 ? pos : count - 1 - pos;
          groups[targetIdx].items.push(item);
        });
      } else {
        sorted.forEach((item, idx) => {
          const round = Math.floor(idx / count);
          const pos = idx % count;
          const targetIdx = round % 2 === 0 ? pos : count - 1 - pos;
          groups[targetIdx].items.push(item);
        });
      }
    }

    return groups;
  }

  /**
   * Standard ITF/KTA Tournament Bracket Seed Ordering for power-of-2 bracket size.
   * Ensures Seed 1 and Seed 2 only meet in Final, and BYEs go to top seeds first.
   */
  function getBracketSeedOrder(size) {
    if (size <= 2) return [1, 2];
    const prev = getBracketSeedOrder(size / 2);
    const result = [];
    for (let i = 0; i < prev.length; i++) {
      result.push(prev[i]);
      result.push(size + 1 - prev[i]);
    }
    return result;
  }

  function roundName(teamsInRound) {
    if (teamsInRound === 2) return '결승';
    if (teamsInRound === 4) return '4강 (준결승)';
    if (teamsInRound === 8) return '8강';
    if (teamsInRound === 16) return '16강';
    if (teamsInRound === 32) return '32강';
    return `${teamsInRound}강`;
  }

  /**
   * Generate Tournament Brackets per Group.
   * Each group runs its own single-elimination bracket with automatic BYE advancement.
   */
  function generateTournament(players, config) {
    const cfg = Object.assign({
      teamMode: 'mixed',
      pairingStrategy: 'balanced',
      groupCount: 1,
      groupMode: 'skill-tier', // 'skill-tier' | 'balanced'
      levels: SKILL_PRESETS.abcde.levels,
      allowMixedOverflow: true,
    }, config || {});

    const { teams, leftovers, warnings } = buildDoublesTeams(players, cfg);
    if (teams.length < 2) {
      warnings.push('토너먼트를 진행하려면 최소 2팀(4명) 이상이 필요합니다.');
      return { groups: [], teams, leftovers, warnings };
    }

    const effectiveGroupCount = Math.min(cfg.groupCount, Math.max(1, Math.floor(teams.length / 2)));
    if (effectiveGroupCount < cfg.groupCount) {
      warnings.push(`팀 수(${teams.length}팀)에 비해 그룹 수가 많아 ${effectiveGroupCount}개 그룹으로 자동 조정했습니다.`);
    }

    const rawGroups = allocateIntoGroups(
      teams,
      effectiveGroupCount,
      cfg.groupMode,
      (t) => t.avgWeight,
      null
    );

    const groups = rawGroups.map((g) => {
      const seededTeams = g.items.slice().sort((a, b) => b.avgWeight - a.avgWeight);
      const n = seededTeams.length;
      let bracketSize = 2;
      while (bracketSize < n) bracketSize *= 2;
      const numRounds = Math.log2(bracketSize);
      const seedOrder = getBracketSeedOrder(bracketSize);

      const rounds = [];
      for (let r = 0; r < numRounds; r++) {
        const matchCount = bracketSize / Math.pow(2, r + 1);
        const rName = roundName(matchCount * 2);
        const matches = [];
        for (let m = 0; m < matchCount; m++) {
          let teamA = null;
          let teamB = null;
          let isBye = false;

          if (r === 0) {
            const seedA = seedOrder[m * 2];
            const seedB = seedOrder[m * 2 + 1];
            teamA = seedA <= n ? seededTeams[seedA - 1] : null;
            teamB = seedB <= n ? seededTeams[seedB - 1] : null;
            if ((teamA && !teamB) || (!teamA && teamB)) {
              isBye = true;
            }
          }

          matches.push({
            id: uid('tm'),
            groupId: g.id,
            roundIndex: r,
            roundName: rName,
            matchIndex: m,
            teamA: teamA ? { id: teamA.id, name: teamA.name, players: teamA.players, division: teamA.division, isMixedOverflow: teamA.isMixedOverflow, avgWeight: teamA.avgWeight } : null,
            teamB: teamB ? { id: teamB.id, name: teamB.name, players: teamB.players, division: teamB.division, isMixedOverflow: teamB.isMixedOverflow, avgWeight: teamB.avgWeight } : null,
            scoreA: null,
            scoreB: null,
            status: isBye ? 'bye' : 'pending', // 'pending' | 'completed' | 'bye' | 'walkover'
            winnerSide: isBye ? (teamA ? 'A' : 'B') : null,
            note: isBye ? '부전승 (BYE)' : '',
          });
        }
        rounds.push({ roundIndex: r, name: rName, matches });
      }

      // Propagate Round 0 BYEs to Round 1
      propagateBracketWinners(rounds);

      return {
        id: g.id,
        name: g.name,
        teams: seededTeams,
        rounds,
      };
    });

    return { groups, teams, leftovers, warnings };
  }

  /**
   * Propagate completed/bye winners through tournament rounds cleanly.
   */
  function propagateBracketWinners(rounds) {
    for (let r = 0; r < rounds.length - 1; r++) {
      const curr = rounds[r].matches;
      const next = rounds[r + 1].matches;
      for (let m = 0; m < curr.length; m++) {
        const match = curr[m];
        const nextMatch = next[Math.floor(m / 2)];
        const slot = m % 2 === 0 ? 'teamA' : 'teamB';

        let winnerTeam = null;
        if (match.winnerSide === 'A') winnerTeam = match.teamA;
        else if (match.winnerSide === 'B') winnerTeam = match.teamB;

        const prevTeamId = nextMatch[slot] ? nextMatch[slot].id : null;
        const newTeamId = winnerTeam ? winnerTeam.id : null;

        if (prevTeamId !== newTeamId) {
          nextMatch[slot] = winnerTeam ? Object.assign({}, winnerTeam) : null;
          // If the next match already had a result with a different team, reset downstream safely
          if (nextMatch.status === 'completed' || nextMatch.status === 'walkover') {
            nextMatch.scoreA = null;
            nextMatch.scoreB = null;
            nextMatch.status = 'pending';
            nextMatch.winnerSide = null;
            nextMatch.note = '';
          }
        }
      }
    }
  }

  /**
   * Recommend optimal number of games per player for Individual (KDK) Doubles.
   */
  function recommendIndividualGames(playerCount) {
    if (playerCount < 4) {
      return { recommended: 0, options: [], reason: '복식 경기는 그룹당 최소 4명 이상 필요합니다.' };
    }
    if (playerCount === 4) {
      return {
        recommended: 3,
        options: [3, 4],
        reason: '4명 구성 시 3게임을 진행하면 모든 참가자가 서로 한 번씩 파트너가 됩니다 (총 3경기).',
      };
    }
    // Find game counts (2..6) where (playerCount * g) % 4 === 0 for exact integer rounds
    const exact = [];
    for (let g = 2; g <= 6; g++) {
      if ((playerCount * g) % 4 === 0) exact.push(g);
    }
    let rec = 4;
    if (exact.includes(4)) rec = 4;
    else if (exact.length > 0) rec = exact.find((g) => g >= 3) || exact[0];
    else rec = 4;

    const totalMatches = Math.ceil((playerCount * rec) / 4);
    const exactNote =
      (playerCount * rec) % 4 === 0
        ? `전원 정확히 ${rec}게임 출전 (총 ${totalMatches}경기, 휴식 균등)`
        : `총 ${totalMatches}경기 편성 (인원수 특성상 일부 선수 ±1경기 보정 또는 대기자 로테이션)`;

    return {
      recommended: rec,
      options: [2, 3, 4, 5, 6],
      reason: `${playerCount}명 기준 추천: 1인당 ${rec}게임 — ${exactNote}`,
    };
  }

  /**
   * Generate Individual (KDK-style partner rotation) Doubles schedule per group.
   * Balances:
   *  1. Equal games played per player (minimizes play-count variance)
   *  2. Unique partners (avoids repeating partners)
   *  3. Unique opponents
   *  4. Skill balance between Team A and Team B
   *  5. Respects teamMode ('men' | 'women' | 'mixed') while flexibly allowing mixed-overflow when counts don't divide evenly
   */
  function generateIndividualMode(players, config) {
    const cfg = Object.assign({
      teamMode: 'mixed',
      groupCount: 1,
      groupMode: 'skill-tier', // 'skill-tier' | 'balanced'
      gamesPerPlayer: 4,
      levels: SKILL_PRESETS.abcde.levels,
    }, config || {});

    const active = getActivePlayers(players).map((p) => ({
      ...p,
      _w: getSkillWeight(p.skill, cfg.levels),
    }));

    const warnings = [];
    if (active.length < 4) {
      warnings.push('개인전(복식 로테이션)을 진행하려면 최소 4명 이상의 참가자가 필요합니다.');
      return { groups: [], warnings };
    }

    // Filter or warn if teamMode is men/women but opposite gender exists
    const menCount = active.filter((p) => p.gender === 'M').length;
    const womenCount = active.filter((p) => p.gender === 'F').length;
    if (cfg.teamMode === 'men' && womenCount > 0) {
      warnings.push(`남성복식 설정에 여성 ${womenCount}명이 포함되어 있어, 혼성 매칭이 유연하게 발생할 수 있습니다.`);
    } else if (cfg.teamMode === 'women' && menCount > 0) {
      warnings.push(`여성복식 설정에 남성 ${menCount}명이 포함되어 있어, 혼성 매칭이 유연하게 발생할 수 있습니다.`);
    }

    const maxGroups = Math.max(1, Math.floor(active.length / 4));
    const effectiveGroups = Math.min(cfg.groupCount, maxGroups);
    if (effectiveGroups < cfg.groupCount) {
      warnings.push(`그룹당 최소 4명이 필요해 ${effectiveGroups}개 그룹으로 자동 조정했습니다.`);
    }

    const rawGroups = allocateIntoGroups(
      active,
      effectiveGroups,
      cfg.groupMode,
      (p) => p._w,
      (p) => p.gender
    );

    const groups = rawGroups.map((g) => {
      const grpPlayers = g.items;
      const targetGames = Math.max(1, Number(cfg.gamesPerPlayer) || recommendIndividualGames(grpPlayers.length).recommended);
      const { matches, groupWarnings } = buildKdkScheduleForGroup(g.id, grpPlayers, targetGames, cfg.teamMode);
      warnings.push(...groupWarnings.map((w) => `[${g.name}] ${w}`));

      return {
        id: g.id,
        name: g.name,
        players: grpPlayers.map((p) => ({ id: p.id, name: p.name, gender: p.gender, skill: p.skill, weight: p._w })),
        targetGamesPerPlayer: targetGames,
        matches,
      };
    });

    return { groups, warnings };
  }

  function buildKdkScheduleForGroup(groupId, grpPlayers, targetGames, teamMode) {
    const n = grpPlayers.length;
    const groupWarnings = [];
    if (n < 4) {
      groupWarnings.push('참가자가 4명 미만이어서 복식 경기를 생성할 수 없습니다.');
      return { matches: [], groupWarnings };
    }

    const totalSlots = n * targetGames;
    const totalMatches = Math.ceil(totalSlots / 4);
    if (totalSlots % 4 !== 0) {
      const extra = totalMatches * 4 - totalSlots;
      groupWarnings.push(
        `인원(${n}명) × ${targetGames}게임이 4의 배수가 아니므로, 총 ${totalMatches}경기로 편성하고 ${extra}명이 1경기 추가 출전(공정 로테이션)합니다.`
      );
    }

    const playCount = {};
    const partnerCount = {};
    const opponentCount = {};
    const lastPlayedMatch = {};
    grpPlayers.forEach((p) => {
      playCount[p.id] = 0;
      lastPlayedMatch[p.id] = -10;
    });

    function pairKey(a, b) {
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    const matches = [];
    for (let mIdx = 0; mIdx < totalMatches; mIdx++) {
      // Select 4 players prioritizing lowest playCount, then longest rest
      const candidates = grpPlayers.slice().sort((a, b) => {
        if (playCount[a.id] !== playCount[b.id]) return playCount[a.id] - playCount[b.id];
        if (lastPlayedMatch[a.id] !== lastPlayedMatch[b.id]) return lastPlayedMatch[a.id] - lastPlayedMatch[b.id];
        return Math.random() - 0.5;
      });
      const four = candidates.slice(0, 4);

      // Evaluate all 3 possible ways to split 4 players into 2 doubles teams:
      // (0,1 vs 2,3), (0,2 vs 1,3), (0,3 vs 1,2)
      const splits = [
        [[four[0], four[1]], [four[2], four[3]]],
        [[four[0], four[2]], [four[1], four[3]]],
        [[four[0], four[3]], [four[1], four[2]]],
      ];

      let bestSplit = splits[0];
      let bestCost = Infinity;

      for (const [tA, tB] of splits) {
        let cost = 0;
        // 1. Penalize repeated partners heavily
        cost += (partnerCount[pairKey(tA[0].id, tA[1].id)] || 0) * 100;
        cost += (partnerCount[pairKey(tB[0].id, tB[1].id)] || 0) * 100;

        // 2. Penalize repeated opponents moderately
        for (const a of tA) {
          for (const b of tB) {
            cost += (opponentCount[pairKey(a.id, b.id)] || 0) * 8;
          }
        }

        // 3. Skill balance difference between Team A and Team B
        const wA = tA[0]._w + tA[1]._w;
        const wB = tB[0]._w + tB[1]._w;
        cost += Math.abs(wA - wB) * 15;

        // 4. Gender alignment with teamMode
        const aMixed = tA[0].gender !== tA[1].gender;
        const bMixed = tB[0].gender !== tB[1].gender;
        if (teamMode === 'mixed') {
          if (!aMixed) cost += 20;
          if (!bMixed) cost += 20;
        } else if (teamMode === 'men' || teamMode === 'women') {
          if (aMixed) cost += 25;
          if (bMixed) cost += 25;
        }

        if (cost < bestCost) {
          bestCost = cost;
          bestSplit = [tA, tB];
        }
      }

      const [teamA, teamB] = bestSplit;
      // Record stats
      [...teamA, ...teamB].forEach((p) => {
        playCount[p.id]++;
        lastPlayedMatch[p.id] = mIdx;
      });
      const pkA = pairKey(teamA[0].id, teamA[1].id);
      const pkB = pairKey(teamB[0].id, teamB[1].id);
      partnerCount[pkA] = (partnerCount[pkA] || 0) + 1;
      partnerCount[pkB] = (partnerCount[pkB] || 0) + 1;
      for (const a of teamA) {
        for (const b of teamB) {
          const ok = pairKey(a.id, b.id);
          opponentCount[ok] = (opponentCount[ok] || 0) + 1;
        }
      }

      const isMixedFlag =
        (teamMode === 'men' || teamMode === 'women') &&
        (teamA[0].gender !== teamA[1].gender || teamB[0].gender !== teamB[1].gender);

      matches.push({
        id: uid('im'),
        groupId,
        order: mIdx + 1,
        teamA: {
          players: [teamA[0].id, teamA[1].id],
          names: [teamA[0].name, teamA[1].name],
          label: `${teamA[0].name} / ${teamA[1].name}`,
          genders: [teamA[0].gender, teamA[1].gender],
          weightSum: teamA[0]._w + teamA[1]._w,
        },
        teamB: {
          players: [teamB[0].id, teamB[1].id],
          names: [teamB[0].name, teamB[1].name],
          label: `${teamB[0].name} / ${teamB[1].name}`,
          genders: [teamB[0].gender, teamB[1].gender],
          weightSum: teamB[0]._w + teamB[1]._w,
        },
        scoreA: null,
        scoreB: null,
        status: 'pending',
        isMixedOverflow: isMixedFlag,
        note: isMixedFlag ? '성별 보정 매칭' : '',
      });
    }

    return { matches, groupWarnings };
  }

  /**
   * Recommend optimal number of matches per tie (그룹 대항전 게임수 추천)
   */
  function recommendGroupGames(totalPlayers, groupCount) {
    const avgPerGroup = Math.floor(totalPlayers / Math.max(1, groupCount));
    if (avgPerGroup < 2) {
      return { recommended: 1, options: [1, 2, 3], reason: '그룹당 최소 2명(1복식) 이상이어야 단체전을 진행할 수 있습니다.' };
    }
    const maxUniquePairs = Math.floor(avgPerGroup / 2);
    // Prefer odd number of games (3 or 5) to avoid group-tie draws
    let rec = 3;
    if (avgPerGroup >= 10) rec = 5;
    else if (avgPerGroup >= 6) rec = 3;
    else if (avgPerGroup >= 4) rec = 3;
    else rec = 1;

    return {
      recommended: rec,
      options: [1, 2, 3, 4, 5, 6, 7],
      reason: `그룹당 평균 ${avgPerGroup}명(고유 복식조 ${maxUniquePairs}팀 가능) 기준, 승부 결정력이 좋은 ${rec}복식(경기)을 추천합니다.`,
    };
  }

  /**
   * Generate Group Match (단체전):
   *  1. Snake-draft players into `groupCount` balanced groups by gender & skill.
   *  2. Assign a default Group Captain (highest skill or first member, editable by user).
   *  3. Create Round-Robin ties between groups, each tie having `gamesPerTie` ordered doubles slots.
   *  4. Each group has an editable `lineup` array (length = gamesPerTie) that the group captain fills in!
   */
  function generateGroupMode(players, config) {
    const cfg = Object.assign({
      teamMode: 'mixed',
      groupCount: 2,
      gamesPerTie: 3,
      levels: SKILL_PRESETS.abcde.levels,
    }, config || {});

    const active = getActivePlayers(players).map((p) => ({
      ...p,
      _w: getSkillWeight(p.skill, cfg.levels),
    }));

    const warnings = [];
    const effGroups = Math.max(2, Math.min(Number(cfg.groupCount) || 2, Math.floor(active.length / 2) || 2));
    if (active.length < 4) {
      warnings.push('그룹전(단체전)을 진행하려면 최소 4명(2그룹 × 2명) 이상 필요합니다.');
      return { groups: [], ties: [], warnings };
    }
    if (effGroups < cfg.groupCount) {
      warnings.push(`그룹당 최소 2명(1복식)이 필요해 ${effGroups}개 그룹으로 조정했습니다.`);
    }

    const rawGroups = allocateIntoGroups(
      active,
      effGroups,
      'balanced',
      (p) => p._w,
      (p) => p.gender
    );

    const gamesPerTie = Math.max(1, Number(cfg.gamesPerTie) || recommendGroupGames(active.length, effGroups).recommended);

    const groups = rawGroups.map((g) => {
      const members = g.items.map((p) => ({
        id: p.id,
        name: p.name,
        gender: p.gender,
        skill: p.skill,
        weight: p._w,
      }));
      const avgWeight = members.length
        ? Number((members.reduce((s, m) => s + m.weight, 0) / members.length).toFixed(2))
        : 0;
      const autoLineup = buildAutoLineupForGroup(members, gamesPerTie, cfg.teamMode);
      return {
        id: g.id,
        name: `${g.name} 팀`,
        captainId: members[0] ? members[0].id : null,
        members,
        avgWeight,
        lineup: autoLineup, // Array of { order, p1Id, p2Id }
        lineupSubmitted: false,
      };
    });

    // Generate Round-Robin Ties between all groups
    const ties = [];
    let tieOrder = 1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const gA = groups[i];
        const gB = groups[j];
        const matches = [];
        for (let k = 0; k < gamesPerTie; k++) {
          matches.push({
            id: uid('gm'),
            tieId: null, // assigned below
            order: k + 1,
            teamAPlayers: [gA.lineup[k]?.p1Id || null, gA.lineup[k]?.p2Id || null],
            teamBPlayers: [gB.lineup[k]?.p1Id || null, gB.lineup[k]?.p2Id || null],
            scoreA: null,
            scoreB: null,
            status: 'pending',
            note: '',
          });
        }
        const tieId = uid('tie');
        matches.forEach((m) => (m.tieId = tieId));
        ties.push({
          id: tieId,
          order: tieOrder++,
          groupAId: gA.id,
          groupBId: gB.id,
          matches,
        });
      }
    }

    return { groups, ties, gamesPerTie, warnings };
  }

  /**
   * Helper: Auto-fill a balanced lineup of `gamesPerTie` doubles pairs for a group.
   */
  function buildAutoLineupForGroup(members, gamesPerTie, teamMode) {
    const lineup = [];
    if (members.length < 2) {
      for (let k = 0; k < gamesPerTie; k++) {
        lineup.push({ order: k + 1, p1Id: members[0]?.id || null, p2Id: null });
      }
      return lineup;
    }

    const usage = {};
    members.forEach((m) => (usage[m.id] = 0));

    for (let k = 0; k < gamesPerTie; k++) {
      const sorted = members.slice().sort((a, b) => {
        if (usage[a.id] !== usage[b.id]) return usage[a.id] - usage[b.id];
        return b.weight - a.weight;
      });
      const p1 = sorted[0];
      let p2 = sorted[1];

      if (teamMode === 'mixed') {
        const opp = sorted.slice(1).find((m) => m.gender !== p1.gender);
        if (opp) p2 = opp;
      } else if (teamMode === 'men' || teamMode === 'women') {
        const same = sorted.slice(1).find((m) => m.gender === p1.gender);
        if (same) p2 = same;
      }

      usage[p1.id]++;
      usage[p2.id]++;
      lineup.push({ order: k + 1, p1Id: p1.id, p2Id: p2.id });
    }
    return lineup;
  }

  /**
   * Generate Event Mode (자유 친선/믹스 매치) matches on demand.
   */
  function generateEventRound(players, existingMatches, config) {
    const cfg = Object.assign({
      teamMode: 'mixed',
      pairingStrategy: 'random', // 'random' | 'balanced'
      levels: SKILL_PRESETS.abcde.levels,
      formatLabel: '7점 타이브레이크',
    }, config || {});

    const active = getActivePlayers(players).map((p) => ({
      ...p,
      _w: getSkillWeight(p.skill, cfg.levels),
    }));

    const warnings = [];
    if (active.length < 4) {
      warnings.push('이벤트 복식 매치를 생성하려면 최소 4명 이상 필요합니다.');
      return { newMatches: [], resting: active, warnings };
    }

    // Shuffle or sort by play count so everyone plays evenly
    const playCounts = {};
    active.forEach((p) => (playCounts[p.id] = 0));
    (existingMatches || []).forEach((m) => {
      [...(m.teamA.players || []), ...(m.teamB.players || [])].forEach((pid) => {
        if (playCounts[pid] !== undefined) playCounts[pid]++;
      });
    });

    const pool = active.slice().sort((a, b) => {
      if (playCounts[a.id] !== playCounts[b.id]) return playCounts[a.id] - playCounts[b.id];
      return Math.random() - 0.5;
    });

    const usableCount = Math.floor(pool.length / 4) * 4;
    const playing = pool.slice(0, usableCount);
    const resting = pool.slice(usableCount);

    if (resting.length > 0) {
      warnings.push(`인원(${pool.length}명) 중 ${resting.map((p) => p.name).join(', ')} 선수는 이번 라운드 휴식 후 다음 라운드 우선 배정됩니다.`);
    }

    const { teams } = buildDoublesTeams(playing, {
      teamMode: cfg.teamMode,
      pairingStrategy: cfg.pairingStrategy === 'balanced' ? 'balanced' : 'similar',
      levels: cfg.levels,
      allowMixedOverflow: true,
    });

    // Pair teams against closest avgWeight
    const sortedTeams = teams.slice().sort((a, b) => b.avgWeight - a.avgWeight);
    const newMatches = [];
    const baseOrder = (existingMatches || []).length;
    for (let i = 0; i + 1 < sortedTeams.length; i += 2) {
      const tA = sortedTeams[i];
      const tB = sortedTeams[i + 1];
      newMatches.push({
        id: uid('em'),
        order: baseOrder + newMatches.length + 1,
        formatLabel: cfg.formatLabel,
        teamA: {
          players: tA.players,
          names: tA.playerDetails.map((d) => d.name),
          label: tA.name,
          isMixedOverflow: tA.isMixedOverflow,
        },
        teamB: {
          players: tB.players,
          names: tB.playerDetails.map((d) => d.name),
          label: tB.name,
          isMixedOverflow: tB.isMixedOverflow,
        },
        scoreA: null,
        scoreB: null,
        status: 'pending',
        note: '',
      });
    }

    return { newMatches, resting, warnings };
  }

  /**
   * Official Points & Standings Calculator
   * Rule: Win = +1, Draw = 0, Loss = -1
   * Tie-breaker:
   *   1. points (승점)
   *   2. totalScored (총득점 — user's explicit rule!)
   *   3. scoreDiff (득실차)
   *   4. wins (다승)
   */
  function computeStandings(entities, completedMatches) {
    // entities: [{ id, name, meta? }]
    // completedMatches: [{ sideAIds: [id...], sideBIds: [id...], scoreA, scoreB, status }]
    const map = {};
    entities.forEach((e) => {
      map[e.id] = {
        id: e.id,
        name: e.name,
        meta: e.meta || '',
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        totalScored: 0,
        totalConceded: 0,
        scoreDiff: 0,
      };
    });

    (completedMatches || []).forEach((m) => {
      if (m.status !== 'completed' && m.status !== 'walkover') return;
      const sA = Number(m.scoreA);
      const sB = Number(m.scoreB);
      if (isNaN(sA) || isNaN(sB)) return;

      const resA = sA > sB ? 'W' : sA < sB ? 'L' : 'D';
      const resB = sB > sA ? 'W' : sB < sA ? 'L' : 'D';

      (m.sideAIds || []).forEach((id) => {
        const row = map[id];
        if (!row) return;
        row.played++;
        row.totalScored += sA;
        row.totalConceded += sB;
        if (resA === 'W') { row.wins++; row.points += 1; }
        else if (resA === 'L') { row.losses++; row.points -= 1; }
        else { row.draws++; }
      });

      (m.sideBIds || []).forEach((id) => {
        const row = map[id];
        if (!row) return;
        row.played++;
        row.totalScored += sB;
        row.totalConceded += sA;
        if (resB === 'W') { row.wins++; row.points += 1; }
        else if (resB === 'L') { row.losses++; row.points -= 1; }
        else { row.draws++; }
      });
    });

    const list = Object.values(map).map((r) => {
      r.scoreDiff = r.totalScored - r.totalConceded;
      return r;
    });

    list.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.totalScored !== a.totalScored) return b.totalScored - a.totalScored;
      if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name, 'ko');
    });

    // Assign ranks (shared rank if points & totalScored & scoreDiff all equal)
    list.forEach((row, idx) => {
      if (idx === 0) {
        row.rank = 1;
      } else {
        const prev = list[idx - 1];
        if (
          row.points === prev.points &&
          row.totalScored === prev.totalScored &&
          row.scoreDiff === prev.scoreDiff &&
          row.wins === prev.wins
        ) {
          row.rank = prev.rank;
        } else {
          row.rank = idx + 1;
        }
      }
    });

    return list;
  }

  /**
   * Incident Handler: Substitute a withdrawn player with a replacement player
   * across all pending matches in any tournament type.
   */
  function substitutePlayerInTournament(tournament, oldPlayerId, newPlayer) {
    let replacedCount = 0;
    const type = tournament.type;

    if (type === 'tournament' && tournament.data && tournament.data.groups) {
      tournament.data.groups.forEach((g) => {
        const affectedTeamIds = new Set();
        g.teams.forEach((t) => {
          const idx = t.players.indexOf(oldPlayerId);
          if (idx !== -1) {
            t.players = t.players.slice();
            t.players[idx] = newPlayer.id;
            if (t.playerDetails && t.playerDetails[idx]) {
              t.playerDetails[idx].id = newPlayer.id;
              t.playerDetails[idx].name = newPlayer.name;
              t.playerDetails[idx].gender = newPlayer.gender;
              t.playerDetails[idx].skill = newPlayer.skill;
            }
            t.name = t.playerDetails ? t.playerDetails.map((d) => d.name).join(' / ') : t.name;
            affectedTeamIds.add(t.id);
          }
        });
        g.rounds.forEach((r) => {
          r.matches.forEach((m) => {
            if (m.status !== 'pending') return;
            ['teamA', 'teamB'].forEach((side) => {
              if (m[side] && affectedTeamIds.has(m[side].id)) {
                const matchedTeam = g.teams.find((t) => t.id === m[side].id);
                if (matchedTeam) {
                  m[side].players = matchedTeam.players.slice();
                  m[side].name = matchedTeam.name;
                  replacedCount++;
                }
              }
            });
          });
        });
      });
    } else if (type === 'individual' && tournament.data && tournament.data.groups) {
      tournament.data.groups.forEach((g) => {
        const pIdx = g.players.findIndex((p) => p.id === oldPlayerId);
        if (pIdx !== -1) {
          g.players[pIdx] = {
            id: newPlayer.id,
            name: newPlayer.name,
            gender: newPlayer.gender,
            skill: newPlayer.skill,
            weight: getSkillWeight(newPlayer.skill, tournament.skillLevels),
          };
        }
        g.matches.forEach((m) => {
          if (m.status !== 'pending') return;
          ['teamA', 'teamB'].forEach((side) => {
            const idx = m[side].players.indexOf(oldPlayerId);
            if (idx !== -1) {
              m[side].players[idx] = newPlayer.id;
              m[side].names[idx] = newPlayer.name;
              m[side].genders[idx] = newPlayer.gender;
              m[side].label = m[side].names.join(' / ');
              replacedCount++;
            }
          });
        });
      });
    } else if (type === 'group' && tournament.data && tournament.data.groups) {
      tournament.data.groups.forEach((g) => {
        const mIdx = g.members.findIndex((m) => m.id === oldPlayerId);
        if (mIdx !== -1) {
          g.members[mIdx] = {
            id: newPlayer.id,
            name: newPlayer.name,
            gender: newPlayer.gender,
            skill: newPlayer.skill,
            weight: getSkillWeight(newPlayer.skill, tournament.skillLevels),
          };
          if (g.captainId === oldPlayerId) g.captainId = newPlayer.id;
        }
        g.lineup.forEach((slot) => {
          if (slot.p1Id === oldPlayerId) slot.p1Id = newPlayer.id;
          if (slot.p2Id === oldPlayerId) slot.p2Id = newPlayer.id;
        });
      });
      (tournament.data.ties || []).forEach((tie) => {
        tie.matches.forEach((m) => {
          if (m.status !== 'pending') return;
          ['teamAPlayers', 'teamBPlayers'].forEach((key) => {
            const idx = m[key].indexOf(oldPlayerId);
            if (idx !== -1) {
              m[key][idx] = newPlayer.id;
              replacedCount++;
            }
          });
        });
      });
    } else if (type === 'event' && tournament.data && tournament.data.matches) {
      tournament.data.matches.forEach((m) => {
        if (m.status !== 'pending') return;
        ['teamA', 'teamB'].forEach((side) => {
          const idx = m[side].players.indexOf(oldPlayerId);
          if (idx !== -1) {
            m[side].players[idx] = newPlayer.id;
            m[side].names[idx] = newPlayer.name;
            m[side].label = m[side].names.join(' / ');
            replacedCount++;
          }
        });
      });
    }

    return replacedCount;
  }

  /**
   * Incident Handler: Mark all pending matches of a withdrawn player as Walkover (기권패).
   */
  function walkoverPlayerInTournament(tournament, playerId, walkoverScore) {
    const woScore = Number(walkoverScore) || 6;
    let affected = 0;
    const type = tournament.type;

    if (type === 'tournament' && tournament.data && tournament.data.groups) {
      tournament.data.groups.forEach((g) => {
        g.rounds.forEach((r) => {
          r.matches.forEach((m) => {
            if (m.status !== 'pending') return;
            const inA = m.teamA && m.teamA.players && m.teamA.players.includes(playerId);
            const inB = m.teamB && m.teamB.players && m.teamB.players.includes(playerId);
            if (inA && !inB) {
              m.scoreA = 0;
              m.scoreB = woScore;
              m.status = 'walkover';
              m.winnerSide = 'B';
              m.note = '불참 기권승 (W/O)';
              affected++;
            } else if (inB && !inA) {
              m.scoreA = woScore;
              m.scoreB = 0;
              m.status = 'walkover';
              m.winnerSide = 'A';
              m.note = '불참 기권승 (W/O)';
              affected++;
            }
          });
        });
        propagateBracketWinners(g.rounds);
      });
    } else if (type === 'individual' && tournament.data && tournament.data.groups) {
      tournament.data.groups.forEach((g) => {
        g.matches.forEach((m) => {
          if (m.status !== 'pending') return;
          const inA = m.teamA.players.includes(playerId);
          const inB = m.teamB.players.includes(playerId);
          if (inA && !inB) {
            m.scoreA = 0;
            m.scoreB = woScore;
            m.status = 'walkover';
            m.note = '불참 기권승 (W/O)';
            affected++;
          } else if (inB && !inA) {
            m.scoreA = woScore;
            m.scoreB = 0;
            m.status = 'walkover';
            m.note = '불참 기권승 (W/O)';
            affected++;
          }
        });
      });
    } else if (type === 'group' && tournament.data && tournament.data.ties) {
      tournament.data.ties.forEach((tie) => {
        tie.matches.forEach((m) => {
          if (m.status !== 'pending') return;
          const inA = m.teamAPlayers.includes(playerId);
          const inB = m.teamBPlayers.includes(playerId);
          if (inA && !inB) {
            m.scoreA = 0;
            m.scoreB = woScore;
            m.status = 'walkover';
            m.note = '불참 기권승 (W/O)';
            affected++;
          } else if (inB && !inA) {
            m.scoreA = woScore;
            m.scoreB = 0;
            m.status = 'walkover';
            m.note = '불참 기권승 (W/O)';
            affected++;
          }
        });
      });
    } else if (type === 'event' && tournament.data && tournament.data.matches) {
      tournament.data.matches.forEach((m) => {
        if (m.status !== 'pending') return;
        const inA = m.teamA.players.includes(playerId);
        const inB = m.teamB.players.includes(playerId);
        if (inA && !inB) {
          m.scoreA = 0;
          m.scoreB = woScore;
          m.status = 'walkover';
          m.note = '불참 기권승 (W/O)';
          affected++;
        } else if (inB && !inA) {
          m.scoreA = woScore;
          m.scoreB = 0;
          m.status = 'walkover';
          m.note = '불참 기권승 (W/O)';
          affected++;
        }
      });
    }

    return affected;
  }

  return {
    SKILL_PRESETS,
    MATCH_FORMATS,
    uid,
    getSkillWeight,
    normalizeGender,
    genderLabel,
    teamTypeLabel,
    getActivePlayers,
    buildDoublesTeams,
    allocateIntoGroups,
    generateTournament,
    propagateBracketWinners,
    recommendIndividualGames,
    generateIndividualMode,
    recommendGroupGames,
    generateGroupMode,
    buildAutoLineupForGroup,
    generateEventRound,
    computeStandings,
    substitutePlayerInTournament,
    walkoverPlayerInTournament,
  };
});
