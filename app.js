(function () {
  'use strict';

  const E = window.TennisEngine;
  const STORAGE_KEY = 'courtflow_tennis_app_v1';

  // --- Application State ---
  let state = {
    tournaments: [],
    activeTournamentId: null,
    activeSection: 'roster', // 'roster' | 'setup' | 'matches' | 'standings'
    activeGroupTab: 0,
    modal: null, // null | { type: 'new-tournament' | 'skill-config' | 'incident' | 'manual-event', payload? }
  };

  // --- Utilities ---
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 2800);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tournaments: state.tournaments,
        activeTournamentId: state.activeTournamentId,
      }));
    } catch (err) {
      console.warn('localStorage save failed:', err);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0) {
          state.tournaments = parsed.tournaments;
          state.activeTournamentId = parsed.activeTournamentId || parsed.tournaments[0].id;
          return;
        }
      }
    } catch (err) {
      console.warn('localStorage load failed:', err);
    }
    seedDemoTournaments();
  }

  function getActiveTournament() {
    return state.tournaments.find((t) => t.id === state.activeTournamentId) || state.tournaments[0] || null;
  }

  function typeMeta(type) {
    switch (type) {
      case 'tournament': return { icon: '🏆', label: '토너먼트', short: '토너먼트' };
      case 'individual': return { icon: '🔄', label: '개인전 (KDK)', short: '개인전' };
      case 'group': return { icon: '🛡️', label: '그룹전 (단체전)', short: '그룹전' };
      case 'event': return { icon: '⚡', label: '이벤트 매치', short: '이벤트' };
      default: return { icon: '🎾', label: '대회', short: '대회' };
    }
  }

  function getTournamentProgress(t) {
    let total = 0;
    let done = 0;
    if (!t.data) return { total: 0, done: 0, statusLabel: '접수중' };

    if (t.type === 'tournament' && t.data.groups) {
      t.data.groups.forEach((g) =>
        g.rounds.forEach((r) =>
          r.matches.forEach((m) => {
            if (m.status !== 'bye') {
              total++;
              if (m.status === 'completed' || m.status === 'walkover') done++;
            }
          })
        )
      );
    } else if (t.type === 'individual' && t.data.groups) {
      t.data.groups.forEach((g) =>
        g.matches.forEach((m) => {
          total++;
          if (m.status === 'completed' || m.status === 'walkover') done++;
        })
      );
    } else if (t.type === 'group' && t.data.ties) {
      t.data.ties.forEach((tie) =>
        tie.matches.forEach((m) => {
          total++;
          if (m.status === 'completed' || m.status === 'walkover') done++;
        })
      );
    } else if (t.type === 'event' && t.data.matches) {
      t.data.matches.forEach((m) => {
        total++;
        if (m.status === 'completed' || m.status === 'walkover') done++;
      });
    }

    if (total === 0) return { total: 0, done: 0, statusLabel: '대진전' };
    if (done === total) return { total, done, statusLabel: '완료' };
    return { total, done, statusLabel: `${done}/${total}` };
  }

  // --- Demo Data Seeder ---
  function makeSampleRoster(count) {
    const pool = [
      ['김민수', 'M', 'A'], ['이지영', 'F', 'A'], ['박준혁', 'M', 'B'], ['최수진', 'F', 'B'],
      ['정현우', 'M', 'B'], ['강민지', 'F', 'C'], ['조도윤', 'M', 'C'], ['윤서연', 'F', 'C'],
      ['장지훈', 'M', 'C'], ['임하은', 'F', 'D'], ['한영호', 'M', 'D'], ['오유진', 'F', 'D'],
      ['서태양', 'M', 'A'], ['신다은', 'F', 'B'], ['권성민', 'M', 'D'], ['송예린', 'F', 'E'],
    ];
    return pool.slice(0, count || 12).map(([name, gender, skill]) => ({
      id: E.uid('p'),
      name,
      gender,
      skill,
      status: 'active',
    }));
  }

  function createTournamentObject(opts) {
    const preset = E.SKILL_PRESETS.abcde;
    return {
      id: E.uid('trn'),
      name: opts.name || '새 테니스 대회',
      type: opts.type || 'tournament',
      createdAt: new Date().toISOString().slice(0, 10),
      skillPresetId: preset.id,
      skillLevels: JSON.parse(JSON.stringify(preset.levels)),
      players: opts.players || [],
      config: Object.assign({
        teamMode: 'mixed',
        pairingStrategy: 'balanced',
        groupCount: opts.type === 'group' ? 2 : 1,
        groupMode: 'skill-tier',
        gamesPerPlayer: 4,
        gamesPerTie: 3,
        matchFormat: '6game-noad',
        allowMixedOverflow: true,
        eventFormat: 'tb-7',
      }, opts.config || {}),
      data: null,
      warnings: [],
    };
  }

  function seedDemoTournaments() {
    // 1. Tournament demo (12 players -> 6 teams, 1 group bracket with BYEs)
    const t1 = createTournamentObject({
      name: '봄 정기 복식 토너먼트',
      type: 'tournament',
      players: makeSampleRoster(12),
      config: { teamMode: 'mixed', pairingStrategy: 'balanced', groupCount: 1, groupMode: 'skill-tier', matchFormat: '6game-noad' },
    });
    const r1 = E.generateTournament(t1.players, { ...t1.config, levels: t1.skillLevels });
    t1.data = { groups: r1.groups, teams: r1.teams, leftovers: r1.leftovers };
    t1.warnings = r1.warnings;
    // Pre-fill 1 completed match for visual clarity
    const firstPending = t1.data.groups[0]?.rounds[0]?.matches.find((m) => m.status === 'pending');
    if (firstPending) {
      firstPending.scoreA = 6;
      firstPending.scoreB = 4;
      firstPending.status = 'completed';
      firstPending.winnerSide = 'A';
      E.propagateBracketWinners(t1.data.groups[0].rounds);
    }

    // 2. Individual KDK demo (7 players -> odd count rotation!)
    const t2 = createTournamentObject({
      name: '주말 KDK 개인전',
      type: 'individual',
      players: makeSampleRoster(7),
      config: { teamMode: 'mixed', groupCount: 1, groupMode: 'balanced', gamesPerPlayer: 4, matchFormat: '6game-draw' },
    });
    const r2 = E.generateIndividualMode(t2.players, { ...t2.config, levels: t2.skillLevels });
    t2.data = { groups: r2.groups };
    t2.warnings = r2.warnings;
    if (t2.data.groups[0]?.matches.length >= 2) {
      t2.data.groups[0].matches[0].scoreA = 6;
      t2.data.groups[0].matches[0].scoreB = 3;
      t2.data.groups[0].matches[0].status = 'completed';
      t2.data.groups[0].matches[1].scoreA = 5;
      t2.data.groups[0].matches[1].scoreB = 5;
      t2.data.groups[0].matches[1].status = 'completed';
    }

    // 3. Group Match demo (12 players -> 2 balanced groups, 3 doubles per tie)
    const t3 = createTournamentObject({
      name: '클럽 대항 그룹전',
      type: 'group',
      players: makeSampleRoster(12),
      config: { teamMode: 'mixed', groupCount: 2, gamesPerTie: 3, matchFormat: '6game-noad' },
    });
    const r3 = E.generateGroupMode(t3.players, { ...t3.config, levels: t3.skillLevels });
    t3.data = { groups: r3.groups, ties: r3.ties, gamesPerTie: r3.gamesPerTie };
    t3.warnings = r3.warnings;

    state.tournaments = [t1, t2, t3];
    state.activeTournamentId = t1.id;
    state.activeSection = 'matches';
    saveState();
  }

  // --- Core Actions ---
  function generateDrawForActive() {
    const t = getActiveTournament();
    if (!t) return;
    const cfg = { ...t.config, levels: t.skillLevels };

    if (t.type === 'tournament') {
      const res = E.generateTournament(t.players, cfg);
      t.data = { groups: res.groups, teams: res.teams, leftovers: res.leftovers };
      t.warnings = res.warnings;
    } else if (t.type === 'individual') {
      const res = E.generateIndividualMode(t.players, cfg);
      t.data = { groups: res.groups };
      t.warnings = res.warnings;
    } else if (t.type === 'group') {
      const res = E.generateGroupMode(t.players, cfg);
      t.data = { groups: res.groups, ties: res.ties, gamesPerTie: res.gamesPerTie };
      t.warnings = res.warnings;
    } else if (t.type === 'event') {
      const fmt = E.MATCH_FORMATS[t.config.eventFormat] || E.MATCH_FORMATS['tb-7'];
      const res = E.generateEventRound(t.players, [], {
        teamMode: t.config.teamMode,
        pairingStrategy: t.config.pairingStrategy,
        levels: t.skillLevels,
        formatLabel: fmt.label,
      });
      t.data = { matches: res.newMatches, resting: res.resting };
      t.warnings = res.warnings;
    }

    state.activeGroupTab = 0;
    state.activeSection = 'matches';
    saveState();
    render();
    toast('대진표가 생성되었습니다.');
  }

  function addEventRound() {
    const t = getActiveTournament();
    if (!t || t.type !== 'event') return;
    if (!t.data) t.data = { matches: [], resting: [] };
    const fmt = E.MATCH_FORMATS[t.config.eventFormat] || E.MATCH_FORMATS['tb-7'];
    const res = E.generateEventRound(t.players, t.data.matches, {
      teamMode: t.config.teamMode,
      pairingStrategy: t.config.pairingStrategy,
      levels: t.skillLevels,
      formatLabel: fmt.label,
    });
    t.data.matches.push(...res.newMatches);
    t.data.resting = res.resting;
    t.warnings = res.warnings;
    saveState();
    render();
    if (res.newMatches.length > 0) toast(`이벤트 경기 ${res.newMatches.length}개가 추가되었습니다.`);
  }

  function syncGroupLineupToTies(t, groupId) {
    if (!t.data || !t.data.groups || !t.data.ties) return;
    const grp = t.data.groups.find((g) => g.id === groupId);
    if (!grp) return;
    t.data.ties.forEach((tie) => {
      tie.matches.forEach((m, idx) => {
        if (m.status !== 'pending') return;
        const slot = grp.lineup[idx];
        if (!slot) return;
        if (tie.groupAId === groupId) {
          m.teamAPlayers = [slot.p1Id, slot.p2Id];
        }
        if (tie.groupBId === groupId) {
          m.teamBPlayers = [slot.p1Id, slot.p2Id];
        }
      });
    });
  }

  function updateScore(matchRef, side, rawVal, tournament) {
    const val = rawVal === '' ? null : Math.max(0, parseInt(rawVal, 10));
    if (side === 'A') matchRef.scoreA = isNaN(val) ? null : val;
    if (side === 'B') matchRef.scoreB = isNaN(val) ? null : val;

    if (matchRef.scoreA !== null && matchRef.scoreB !== null) {
      const fmt = E.MATCH_FORMATS[tournament.config.matchFormat] || E.MATCH_FORMATS['6game-noad'];
      if (tournament.type === 'tournament' && matchRef.scoreA === matchRef.scoreB) {
        // In single-elimination tournament, tie cannot advance
        matchRef.status = 'pending';
        matchRef.winnerSide = null;
        matchRef.note = '토너먼트는 동점 불가 (타이브레이크 승자 입력)';
      } else {
        matchRef.status = 'completed';
        matchRef.note = '';
        if (tournament.type === 'tournament') {
          matchRef.winnerSide = matchRef.scoreA > matchRef.scoreB ? 'A' : 'B';
        }
        if (matchRef.scoreA === matchRef.scoreB && !fmt.allowDraw) {
          matchRef.note = '무승부 기록됨 (승점 0)';
        }
      }
    } else {
      if (matchRef.status !== 'bye') {
        matchRef.status = 'pending';
        if (tournament.type === 'tournament') matchRef.winnerSide = null;
      }
    }

    if (tournament.type === 'tournament' && tournament.data && tournament.data.groups) {
      const grp = tournament.data.groups.find((g) => g.id === matchRef.groupId);
      if (grp) E.propagateBracketWinners(grp.rounds);
    }

    saveState();
    render();
  }

  // --- Excel / CSV Import & Export ---
  function handleFileImport(file) {
    const t = getActiveTournament();
    if (!t || !file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (window.XLSX && (ext === 'xlsx' || ext === 'xls' || ext === 'csv')) {
      const reader = new FileReader();
      reader.onload = function (evt) {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = window.XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
          importRosterRows(t, rows);
        } catch (err) {
          toast('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Native CSV fallback
      const reader = new FileReader();
      reader.onload = function (evt) {
        const text = String(evt.target.result || '');
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) {
          toast('CSV 데이터가 비어 있습니다.');
          return;
        }
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map((line) => {
          const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
          const obj = {};
          headers.forEach((h, i) => (obj[h] = cols[i] || ''));
          return obj;
        });
        importRosterRows(t, rows);
      };
      reader.readAsText(file, 'utf-8');
    }
  }

  function importRosterRows(t, rows) {
    const defaultSkill = t.skillLevels[Math.floor(t.skillLevels.length / 2)]?.code || 'C';
    let added = 0;

    rows.forEach((row) => {
      const keys = Object.keys(row);
      const findVal = (patterns) => {
        const k = keys.find((key) => patterns.some((p) => key.toLowerCase().includes(p)));
        return k ? String(row[k]).trim() : '';
      };
      const name = findVal(['이름', '성명', '선수', '참가자', 'name']);
      if (!name) return;
      const rawGender = findVal(['성별', 'gender', 'sex']);
      const rawSkill = findVal(['실력', '등급', '레벨', 'ntrp', '부서', 'skill', 'level', 'grade']);

      t.players.push({
        id: E.uid('p'),
        name,
        gender: E.normalizeGender(rawGender),
        skill: rawSkill || defaultSkill,
        status: 'active',
      });
      added++;
    });

    if (added > 0) {
      saveState();
      render();
      toast(`참가자 ${added}명이 명단에 추가되었습니다.`);
    } else {
      toast('유효한 참가자 행을 찾지 못했습니다. (헤더: 이름, 성별, 실력등급)');
    }
  }

  function downloadExcelTemplate() {
    const t = getActiveTournament();
    const lvls = (t && t.skillLevels) || E.SKILL_PRESETS.abcde.levels;
    const sampleData = [
      { 이름: '김민수', 성별: '남', 실력등급: lvls[0]?.code || 'A' },
      { 이름: '이지영', 성별: '여', 실력등급: lvls[1]?.code || 'B' },
      { 이름: '박준혁', 성별: '남', 실력등급: lvls[2]?.code || 'C' },
      { 이름: '최수진', 성별: '여', 실력등급: lvls[2]?.code || 'C' },
    ];

    if (window.XLSX) {
      const ws = window.XLSX.utils.json_to_sheet(sampleData);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '참가자명단');
      window.XLSX.writeFile(wb, '테니스대회_참가자_업로드양식.xlsx');
      toast('엑셀 업로드 양식(.xlsx)을 다운로드했습니다.');
    } else {
      const csv = '\uFEFF이름,성별,실력등급\n' + sampleData.map((r) => `${r.이름},${r.성별},${r.실력등급}`).join('\n');
      downloadBlob(csv, '테니스대회_참가자_업로드양식.csv', 'text/csv;charset=utf-8');
      toast('CSV 업로드 양식을 다운로드했습니다.');
    }
  }

  function exportBackupJSON() {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tournaments: state.tournaments }, null, 2);
    downloadBlob(payload, `courtflow_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('전체 대회 데이터를 JSON으로 백업했습니다.');
  }

  function importBackupJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed && Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0) {
          state.tournaments = parsed.tournaments;
          state.activeTournamentId = parsed.tournaments[0].id;
          saveState();
          render();
          toast(`백업 파일에서 대회 ${parsed.tournaments.length}개를 복원했습니다.`);
        } else {
          toast('올바른 백업 JSON 형식이 아닙니다.');
        }
      } catch (err) {
        toast('JSON 파싱 오류: ' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportResultsExcel() {
    const t = getActiveTournament();
    if (!t) return;
    const rows = getExportableStandingsRows(t);
    if (!rows.length) {
      toast('내보낼 순위 데이터가 아직 없습니다.');
      return;
    }
    if (window.XLSX) {
      const ws = window.XLSX.utils.json_to_sheet(rows);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '순위표');
      window.XLSX.writeFile(wb, `${t.name}_결과순위표.xlsx`);
      toast('순위표를 엑셀(.xlsx)로 내보냈습니다.');
    } else {
      const headers = Object.keys(rows[0]);
      const csv = '\uFEFF' + headers.join(',') + '\n' + rows.map((r) => headers.map((h) => `"${r[h]}"`).join(',')).join('\n');
      downloadBlob(csv, `${t.name}_결과순위표.csv`, 'text/csv;charset=utf-8');
      toast('순위표를 CSV로 내보냈습니다.');
    }
  }

  function getExportableStandingsRows(t) {
    const blocks = computeStandingsBlocks(t);
    const out = [];
    blocks.forEach((b) => {
      b.rows.forEach((r) => {
        out.push({
          구분: b.title,
          순위: r.rank,
          이름: r.name,
          경기수: r.played,
          승: r.wins,
          무: r.draws,
          패: r.losses,
          승점: r.points,
          총득점: r.totalScored,
          총실점: r.totalConceded,
          득실차: r.scoreDiff,
        });
      });
    });
    return out;
  }

  // --- Standings Computation per Mode ---
  function computeStandingsBlocks(t) {
    if (!t || !t.data) return [];

    if (t.type === 'tournament' && t.data.groups) {
      return t.data.groups.map((g) => {
        const entities = g.teams.map((tm) => ({
          id: tm.id,
          name: tm.name,
          meta: tm.isMixedOverflow ? '혼성 보정' : E.teamTypeLabel(tm.division),
        }));
        const matches = [];
        g.rounds.forEach((r) =>
          r.matches.forEach((m) => {
            if ((m.status === 'completed' || m.status === 'walkover') && m.teamA && m.teamB) {
              matches.push({
                sideAIds: [m.teamA.id],
                sideBIds: [m.teamB.id],
                scoreA: m.scoreA,
                scoreB: m.scoreB,
                status: m.status,
              });
            }
          })
        );
        return { title: `${g.name} 팀 순위`, rows: E.computeStandings(entities, matches) };
      });
    }

    if (t.type === 'individual' && t.data.groups) {
      return t.data.groups.map((g) => {
        const entities = g.players.map((p) => ({
          id: p.id,
          name: p.name,
          meta: `${E.genderLabel(p.gender)} · ${p.skill}`,
        }));
        const matches = g.matches.map((m) => ({
          sideAIds: m.teamA.players,
          sideBIds: m.teamB.players,
          scoreA: m.scoreA,
          scoreB: m.scoreB,
          status: m.status,
        }));
        return { title: `${g.name} 개인 순위`, rows: E.computeStandings(entities, matches) };
      });
    }

    if (t.type === 'group' && t.data.groups) {
      const grpEntities = t.data.groups.map((g) => ({
        id: g.id,
        name: g.name,
        meta: `${g.members.length}명 (평균 ${g.avgWeight})`,
      }));
      const grpMatches = [];
      const playerMatches = [];
      (t.data.ties || []).forEach((tie) => {
        tie.matches.forEach((m) => {
          grpMatches.push({
            sideAIds: [tie.groupAId],
            sideBIds: [tie.groupBId],
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
          });
          playerMatches.push({
            sideAIds: m.teamAPlayers.filter(Boolean),
            sideBIds: m.teamBPlayers.filter(Boolean),
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
          });
        });
      });

      const allPlayers = [];
      t.data.groups.forEach((g) =>
        g.members.forEach((m) =>
          allPlayers.push({ id: m.id, name: m.name, meta: `${g.name} · ${E.genderLabel(m.gender)} · ${m.skill}` })
        )
      );

      return [
        { title: '그룹 종합 순위 (전 경기 합산)', rows: E.computeStandings(grpEntities, grpMatches) },
        { title: '개인 기여도 순위', rows: E.computeStandings(allPlayers, playerMatches) },
      ];
    }

    if (t.type === 'event' && t.data.matches) {
      const entities = t.players.map((p) => ({
        id: p.id,
        name: p.name,
        meta: `${E.genderLabel(p.gender)} · ${p.skill}`,
      }));
      const matches = t.data.matches.map((m) => ({
        sideAIds: m.teamA.players,
        sideBIds: m.teamB.players,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        status: m.status,
      }));
      return [{ title: '이벤트 개인 종합 순위', rows: E.computeStandings(entities, matches) }];
    }

    return [];
  }

  // --- Rendering ---
  function render() {
    const app = document.getElementById('app');
    if (!app) return;
    const t = getActiveTournament();

    app.innerHTML = `
      ${renderHeader(t)}
      <main class="main-container">
        ${t ? renderTournamentWorkspace(t) : renderNoTournament()}
      </main>
      ${renderModal(t)}
      <div id="toast-container" class="toast-container"></div>
    `;

    bindEvents(t);
  }

  function renderHeader(activeT) {
    const tabsHtml = state.tournaments
      .map((t) => {
        const meta = typeMeta(t.type);
        const prog = getTournamentProgress(t);
        const isActive = activeT && t.id === activeT.id;
        return `
          <button class="t-tab ${isActive ? 'active' : ''}" data-action="switch-tournament" data-id="${t.id}">
            <span>${meta.icon}</span>
            <span>${esc(t.name)}</span>
            <span class="t-tab-badge">${esc(prog.statusLabel)}</span>
          </button>
        `;
      })
      .join('');

    return `
      <header class="app-header">
        <div class="header-top">
          <div class="brand">
            <div class="brand-mark">🎾</div>
            <div>
              <h1 class="brand-title">CourtFlow 테니스 대회 매니저</h1>
              <div class="brand-sub">복식 전용 · 토너먼트 · 개인전(KDK) · 그룹전 · 이벤트 통합 운영</div>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn btn-ghost-light btn-sm" data-action="open-backup-import">📂 백업 복원</button>
            <input type="file" id="json-backup-input" accept=".json" style="display:none" />
            <button class="btn btn-ghost-light btn-sm" data-action="export-backup">💾 전체 백업</button>
            <button class="btn btn-clay btn-sm" data-action="open-new-tournament">+ 새 대회</button>
          </div>
        </div>
        <div class="tournament-tabs-bar">
          <div class="tournament-tabs-inner">
            ${tabsHtml}
            <button class="t-tab t-tab-add" data-action="open-new-tournament">+ 대회 탭 추가</button>
          </div>
        </div>
      </header>
    `;
  }

  function renderNoTournament() {
    return `
      <div class="card empty-state">
        <div class="empty-state-icon">🎾</div>
        <h2>진행 중인 대회가 없습니다</h2>
        <p>새 대회를 만들어 참가자 명단을 등록하고 대진표를 구성해보세요.</p>
        <button class="btn btn-primary" data-action="open-new-tournament">+ 새 대회 만들기</button>
      </div>
    `;
  }

  function renderTournamentWorkspace(t) {
    const meta = typeMeta(t.type);
    const activePlayers = E.getActivePlayers(t.players);
    const menCnt = activePlayers.filter((p) => p.gender === 'M').length;
    const womenCnt = activePlayers.filter((p) => p.gender === 'F').length;
    const withdrawnCnt = t.players.length - activePlayers.length;
    const prog = getTournamentProgress(t);
    const fmt = E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad'];

    return `
      <section class="tournament-banner">
        <div class="tournament-banner-left">
          <div class="tournament-title-row">
            <span class="badge badge-green">${meta.icon} ${meta.label}</span>
            <input type="text" class="tournament-name-input" id="tournament-name-input" value="${esc(t.name)}" aria-label="대회 이름" />
          </div>
          <div class="tournament-meta-row">
            <span>팀 구성: <strong>${E.teamTypeLabel(t.config.teamMode)}</strong></span>
            <span>·</span>
            <span>경기 방식: <strong>${esc(fmt.label)}</strong></span>
            <span>·</span>
            <span>승점 규칙: <strong>승 +1 / 무 0 / 패 -1 (동점 시 총득점)</strong></span>
          </div>
        </div>
        <div class="tournament-stats">
          <div class="stat-chip">
            <span class="stat-chip-label">참가 인원</span>
            <span class="stat-chip-val">${activePlayers.length}명</span>
          </div>
          <div class="stat-chip">
            <span class="stat-chip-label">성별 (남/여)</span>
            <span class="stat-chip-val">${menCnt} / ${womenCnt}</span>
          </div>
          <div class="stat-chip">
            <span class="stat-chip-label">경기 진행</span>
            <span class="stat-chip-val">${prog.done} / ${prog.total}</span>
          </div>
          ${withdrawnCnt > 0 ? `
            <div class="stat-chip" style="border-color:var(--danger-border);background:var(--danger-bg);">
              <span class="stat-chip-label" style="color:var(--danger-text);">불참/기권</span>
              <span class="stat-chip-val" style="color:var(--danger-text);">${withdrawnCnt}명</span>
            </div>
          ` : ''}
          <button class="btn btn-danger-soft btn-sm" data-action="delete-tournament" title="현재 대회 탭 삭제">대회 삭제</button>
        </div>
      </section>

      <nav class="section-nav" aria-label="대회 운영 단계">
        <button class="sec-btn ${state.activeSection === 'roster' ? 'active' : ''}" data-action="switch-section" data-sec="roster">
          <span class="sec-step">1</span> 참가자 접수 (${activePlayers.length})
        </button>
        <button class="sec-btn ${state.activeSection === 'setup' ? 'active' : ''}" data-action="switch-section" data-sec="setup">
          <span class="sec-step">2</span> 대회 설정 & 대진 생성
        </button>
        <button class="sec-btn ${state.activeSection === 'matches' ? 'active' : ''}" data-action="switch-section" data-sec="matches">
          <span class="sec-step">3</span> 경기 진행 & 스코어
        </button>
        <button class="sec-btn ${state.activeSection === 'standings' ? 'active' : ''}" data-action="switch-section" data-sec="standings">
          <span class="sec-step">4</span> 순위 & 승점표
        </button>
      </nav>

      ${state.activeSection === 'roster' ? renderRosterSection(t) : ''}
      ${state.activeSection === 'setup' ? renderSetupSection(t) : ''}
      ${state.activeSection === 'matches' ? renderMatchesSection(t) : ''}
      ${state.activeSection === 'standings' ? renderStandingsSection(t) : ''}
    `;
  }

  // --- SECTION 1: ROSTER ---
  function renderRosterSection(t) {
    const levelOptions = t.skillLevels
      .map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`)
      .join('');

    const rowsHtml = t.players.length
      ? t.players
          .map((p, idx) => {
            const isWithdrawn = p.status === 'withdrawn';
            return `
              <tr class="${isWithdrawn ? 'row-withdrawn' : ''}">
                <td class="num" style="width:46px;text-align:center;">${idx + 1}</td>
                <td><strong>${esc(p.name)}</strong> ${isWithdrawn ? '<span class="badge badge-danger">불참</span>' : ''}</td>
                <td>
                  <span class="badge ${p.gender === 'F' ? 'badge-women' : 'badge-men'}">
                    ${p.gender === 'F' ? '여성' : '남성'}
                  </span>
                </td>
                <td>
                  <select class="select" style="width:auto;padding:4px 8px;font-size:12.5px;" data-action="change-player-skill" data-pid="${p.id}">
                    ${t.skillLevels.map((l) => `<option value="${esc(l.code)}" ${l.code === p.skill ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
                  </select>
                </td>
                <td class="num" style="text-align:center;">${E.getSkillWeight(p.skill, t.skillLevels)}</td>
                <td style="text-align:right;white-space:nowrap;">
                  ${isWithdrawn
                    ? `<button class="btn btn-sm" data-action="restore-player" data-pid="${p.id}">복귀</button>`
                    : `<button class="btn btn-sm" data-action="open-incident" data-pid="${p.id}">돌발 불참/대체</button>`
                  }
                  <button class="btn btn-danger-soft btn-sm" data-action="remove-player" data-pid="${p.id}">삭제</button>
                </td>
              </tr>
            `;
          })
          .join('')
      : `<tr><td colspan="6" class="empty-state">아직 등록된 참가자가 없습니다. 위 입력창이나 엑셀 업로드로 명단을 등록하세요.</td></tr>`;

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">직접 참가자 등록</h2>
              <p class="card-desc">지원자의 이름, 성별, 실력등급을 입력하여 즉시 명단에 추가합니다.</p>
            </div>
            <button class="btn btn-sm" data-action="open-skill-config">⚙️ 실력등급 체계 설정</button>
          </div>
          <form id="add-player-form" class="form-row">
            <div class="field" style="flex:1.4;">
              <label for="p-name">이름</label>
              <input id="p-name" class="input" type="text" placeholder="예: 홍길동" required />
            </div>
            <div class="field" style="flex:0.8;min-width:95px;">
              <label for="p-gender">성별</label>
              <select id="p-gender" class="select">
                <option value="M">남성</option>
                <option value="F">여성</option>
              </select>
            </div>
            <div class="field" style="flex:1.1;">
              <label for="p-skill">실력등급</label>
              <select id="p-skill" class="select">${levelOptions}</select>
            </div>
            <button type="submit" class="btn btn-primary">+ 추가</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">엑셀 / CSV 명단 일괄 업로드</h2>
              <p class="card-desc">컬럼명: <strong>이름</strong>, <strong>성별</strong>(남/여), <strong>실력등급</strong> (xlsx, xls, csv 지원)</p>
            </div>
            <button class="btn btn-sm" data-action="download-excel-template">📥 엑셀 양식 다운로드</button>
          </div>
          <div id="excel-dropzone" class="dropzone">
            <div style="font-weight:700;margin-bottom:4px;">📄 클릭하거나 엑셀(.xlsx / .csv) 파일을 여기로 드래그하세요</div>
            <div style="font-size:12px;color:var(--ink-muted);">현재 설정된 실력등급 체계(${esc(t.skillLevels.map((l) => l.code).join(', '))})에 맞춰 자동 매핑됩니다.</div>
            <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" style="display:none" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">접수 명단 (${t.players.length}명)</h2>
            <p class="card-desc">실력등급은 표에서 바로 변경 가능하며, 갑작스런 불참 시 [돌발 불참/대체]로 대체 선수 투입이나 기권 처리를 할 수 있습니다.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" data-action="add-sample-players">👥 샘플 8명 추가</button>
            <button class="btn btn-danger-soft btn-sm" data-action="clear-players">명단 초기화</button>
            <button class="btn btn-primary btn-sm" data-action="switch-section" data-sec="setup">다음: 대회 설정 →</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="center">#</th>
                <th>이름</th>
                <th>성별</th>
                <th>실력등급</th>
                <th class="center">가중치</th>
                <th style="text-align:right;">관리</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- SECTION 2: SETUP & DRAW ---
  function renderSetupSection(t) {
    const activeCount = E.getActivePlayers(t.players).length;
    const menCnt = E.getActivePlayers(t.players).filter((p) => p.gender === 'M').length;
    const womenCnt = E.getActivePlayers(t.players).filter((p) => p.gender === 'F').length;

    const types = [
      { id: 'tournament', title: '🏆 토너먼트', sub: '팀 구성 > 실력/지정수 그룹 생성 > 각 그룹별 토너먼트(BYE 자동 배치)' },
      { id: 'individual', title: '🔄 개인전 (KDK)', sub: '그룹 생성 > 적정 게임수 추천/지정 > 파트너 교체 복식 로테이션' },
      { id: 'group', title: '🛡️ 그룹전 (단체전)', sub: '실력·성별 균등 그룹 배분 > 그룹대표 오더 입력 > 순서별 대항전' },
      { id: 'event', title: '⚡ 이벤트 매치', sub: '자유 친선/믹스 랜덤 매칭, 타이브레이크·원포인트 등 즉석 경기' },
    ];

    const teamModes = [
      { id: 'men', title: '남성복식', sub: `현재 남성 ${menCnt}명 (홀수·여성 혼입 시 유연 보정)` },
      { id: 'women', title: '여성복식', sub: `현재 여성 ${womenCnt}명 (홀수·남성 혼입 시 유연 보정)` },
      { id: 'mixed', title: '혼성복식', sub: `남 ${menCnt} / 여 ${womenCnt} (성비 차이 시 자동 보정)` },
    ];

    // Mode-specific recommendations
    const perGroupEst = Math.floor(activeCount / Math.max(1, t.config.groupCount));
    const indRec = E.recommendIndividualGames(perGroupEst);
    const grpRec = E.recommendGroupGames(activeCount, t.config.groupCount);

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">1. 대회 유형 선택</h2>
            <p class="card-desc">복식(2인 1팀) 기준으로 각 대회 방식에 맞는 대진 알고리즘이 적용됩니다.</p>
          </div>
        </div>
        <div class="choice-grid">
          ${types.map((tp) => `
            <button class="choice-card ${t.type === tp.id ? 'selected' : ''}" data-action="set-type" data-val="${tp.id}">
              <div class="choice-card-title">${tp.title}</div>
              <div class="choice-card-sub">${tp.sub}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">2. 팀 구성 & 유연 보정 규칙</h2>
            <p class="card-desc">인원이 홀수이거나 성비가 맞지 않아도 오류 없이 실력·성별 밸런스를 자동 보정합니다.</p>
          </div>
        </div>
        <div class="choice-grid" style="margin-bottom:14px;">
          ${teamModes.map((tm) => `
            <button class="choice-card ${t.config.teamMode === tm.id ? 'selected' : ''}" data-action="set-team-mode" data-val="${tm.id}">
              <div class="choice-card-title">${tm.title}</div>
              <div class="choice-card-sub">${tm.sub}</div>
            </button>
          `).join('')}
        </div>

        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--ink-secondary);">
          <input type="checkbox" id="chk-mixed-overflow" ${t.config.allowMixedOverflow ? 'checked' : ''} />
          <span>남성/여성 팀 구성 중 잔여 홀수 인원 발생 시 <strong>혼성 보정팀</strong>으로 유연 편성 허용 (권장)</span>
        </label>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">3. 세부 게임 구성 (${typeMeta(t.type).label})</h2>
            <p class="card-desc">현재 활성 참가자 ${activeCount}명 기준으로 적정 그룹 수와 게임 수를 설정합니다.</p>
          </div>
        </div>

        <div class="form-row" style="margin-bottom:14px;">
          <div class="field">
            <label for="cfg-match-format">테니스 공식 경기 규칙</label>
            <select id="cfg-match-format" class="select">
              ${Object.values(E.MATCH_FORMATS).map((f) => `
                <option value="${f.id}" ${t.config.matchFormat === f.id ? 'selected' : ''}>${esc(f.label)}</option>
              `).join('')}
            </select>
          </div>

          ${t.type !== 'event' ? `
            <div class="field" style="max-width:170px;">
              <label for="cfg-group-count">생성 그룹 수</label>
              <select id="cfg-group-count" class="select">
                ${(t.type === 'group' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4]).map((n) => `
                  <option value="${n}" ${Number(t.config.groupCount) === n ? 'selected' : ''}>${n}개 그룹</option>
                `).join('')}
              </select>
            </div>
          ` : ''}

          ${(t.type === 'tournament' || t.type === 'individual') ? `
            <div class="field">
              <label for="cfg-group-mode">그룹 배분 기준</label>
              <select id="cfg-group-mode" class="select">
                <option value="skill-tier" ${t.config.groupMode === 'skill-tier' ? 'selected' : ''}>실력등급별 그룹 (A조 상위권, B조 중위권...)</option>
                <option value="balanced" ${t.config.groupMode === 'balanced' ? 'selected' : ''}>전 그룹 균등 밸런스 (스네이크 배분)</option>
              </select>
            </div>
          ` : ''}

          ${(t.type === 'tournament' || t.type === 'event') ? `
            <div class="field">
              <label for="cfg-pairing-strategy">복식 페어링 전략</label>
              <select id="cfg-pairing-strategy" class="select">
                <option value="balanced" ${t.config.pairingStrategy === 'balanced' ? 'selected' : ''}>밸런스 조합 (상위 + 하위 실력 평준화)</option>
                <option value="similar" ${t.config.pairingStrategy === 'similar' ? 'selected' : ''}>동급 조합 (비슷한 실력끼리 페어)</option>
              </select>
            </div>
          ` : ''}

          ${t.type === 'individual' ? `
            <div class="field" style="max-width:200px;">
              <label for="cfg-games-per-player">1인당 적정 게임수</label>
              <select id="cfg-games-per-player" class="select">
                ${[2, 3, 4, 5, 6].map((g) => `
                  <option value="${g}" ${Number(t.config.gamesPerPlayer) === g ? 'selected' : ''}>${g}게임 ${g === indRec.recommended ? '(추천)' : ''}</option>
                `).join('')}
              </select>
            </div>
          ` : ''}

          ${t.type === 'group' ? `
            <div class="field" style="max-width:200px;">
              <label for="cfg-games-per-tie">대항전 적정 경기수 (복식)</label>
              <select id="cfg-games-per-tie" class="select">
                ${[1, 2, 3, 4, 5, 6, 7].map((g) => `
                  <option value="${g}" ${Number(t.config.gamesPerTie) === g ? 'selected' : ''}>${g}복식 ${g === grpRec.recommended ? '(추천)' : ''}</option>
                `).join('')}
              </select>
            </div>
          ` : ''}

          ${t.type === 'event' ? `
            <div class="field">
              <label for="cfg-event-format">이벤트 라운드 기본 형식</label>
              <select id="cfg-event-format" class="select">
                ${Object.values(E.MATCH_FORMATS).map((f) => `
                  <option value="${f.id}" ${t.config.eventFormat === f.id ? 'selected' : ''}>${esc(f.label)}</option>
                `).join('')}
              </select>
            </div>
          ` : ''}
        </div>

        ${t.type === 'individual' ? `
          <div class="alert alert-info">
            <strong>💡 적정 게임수 추천:</strong> ${esc(indRec.reason)}
          </div>
        ` : ''}

        ${t.type === 'group' ? `
          <div class="alert alert-info">
            <strong>💡 그룹전 적정 경기수 추천:</strong> ${esc(grpRec.reason)}
          </div>
        ` : ''}

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
          <button class="btn" data-action="switch-section" data-sec="roster">← 명단 수정</button>
          <button class="btn btn-primary" data-action="generate-draw" ${activeCount < 4 ? 'disabled' : ''}>
            🎾 대진표 자동 생성 (${activeCount}명)
          </button>
        </div>
      </div>
    `;
  }

  // --- SECTION 3: MATCHES ---
  function renderMatchesSection(t) {
    if (!t.data) {
      return `
        <div class="card empty-state">
          <div class="empty-state-icon">📋</div>
          <h3>아직 생성된 대진표가 없습니다</h3>
          <p>[2. 대회 설정 & 대진 생성]에서 옵션을 확인하고 대진표를 생성하세요.</p>
          <button class="btn btn-primary" data-action="switch-section" data-sec="setup">대회 설정으로 이동</button>
        </div>
      `;
    }

    const warningsHtml = (t.warnings && t.warnings.length)
      ? `
        <div class="alert alert-warn">
          <strong>⚠️ 밸런스 보정 및 운영 안내</strong>
          ${t.warnings.map((w) => `<div>• ${esc(w)}</div>`).join('')}
        </div>
      `
      : '';

    const incidentBar = `
      <div class="card" style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div style="font-size:13px;color:var(--ink-secondary);">
          스코어를 입력하면 <strong>승점(승+1 / 무0 / 패-1)</strong>과 <strong>순위표</strong>가 실시간으로 자동 계산됩니다.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" data-action="open-incident">🚨 갑작스런 불참 / 대체 처리</button>
          <button class="btn btn-sm" data-action="switch-section" data-sec="standings">📊 순위표 보기 →</button>
        </div>
      </div>
    `;

    let bodyHtml = '';
    if (t.type === 'tournament') bodyHtml = renderTournamentMatches(t);
    else if (t.type === 'individual') bodyHtml = renderIndividualMatches(t);
    else if (t.type === 'group') bodyHtml = renderGroupMatches(t);
    else if (t.type === 'event') bodyHtml = renderEventMatches(t);

    return `${warningsHtml}${incidentBar}${bodyHtml}`;
  }

  function renderTournamentMatches(t) {
    const groups = t.data.groups || [];
    if (!groups.length) return '<div class="card empty-state">생성된 토너먼트 그룹이 없습니다.</div>';

    const gIdx = Math.min(state.activeGroupTab, groups.length - 1);
    const activeGroup = groups[gIdx];

    const groupTabs = groups.length > 1
      ? `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
          ${groups.map((g, idx) => `
            <button class="btn btn-sm ${idx === gIdx ? 'btn-primary' : ''}" data-action="switch-group-tab" data-idx="${idx}">
              ${esc(g.name)} (${g.teams.length}팀)
            </button>
          `).join('')}
        </div>`
      : '';

    const roundsHtml = activeGroup.rounds
      .map((r) => {
        const matchesHtml = r.matches
          .map((m) => {
            const isBye = m.status === 'bye';
            const isDone = m.status === 'completed' || m.status === 'walkover';
            const canEdit = !isBye && m.teamA && m.teamB;
            return `
              <div class="bracket-match ${isDone ? 'is-completed' : ''} ${isBye ? 'is-bye' : ''}">
                <div class="bm-row ${m.winnerSide === 'A' ? 'is-winner' : ''}">
                  <div class="bm-team ${!m.teamA ? 'empty' : ''}">
                    ${m.teamA ? esc(m.teamA.name) : '대기 중 (TBD)'}
                    ${m.teamA?.isMixedOverflow ? '<span class="badge badge-mixed" style="font-size:10px;padding:1px 5px;margin-left:4px;">혼성보정</span>' : ''}
                  </div>
                  ${canEdit ? `<input type="number" min="0" max="99" class="bm-score-input" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-side="A" />` : ''}
                </div>
                <div class="bm-row ${m.winnerSide === 'B' ? 'is-winner' : ''}">
                  <div class="bm-team ${!m.teamB ? 'empty' : ''}">
                    ${m.teamB ? esc(m.teamB.name) : (isBye ? 'BYE (부전승)' : '대기 중 (TBD)')}
                    ${m.teamB?.isMixedOverflow ? '<span class="badge badge-mixed" style="font-size:10px;padding:1px 5px;margin-left:4px;">혼성보정</span>' : ''}
                  </div>
                  ${canEdit ? `<input type="number" min="0" max="99" class="bm-score-input" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-side="B" />` : ''}
                </div>
                <div class="bm-footer">
                  <span>${m.note ? esc(m.note) : (isDone ? '✅ 경기 완료' : (canEdit ? '스코어 입력 대기' : '이전 라운드 대기'))}</span>
                  ${canEdit && !isDone ? `
                    <span style="display:flex;gap:4px;">
                      <button class="btn btn-sm" style="padding:1px 6px;font-size:10.5px;" data-action="wo-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-winner="A" title="상단 팀 기권승">상 W/O</button>
                      <button class="btn btn-sm" style="padding:1px 6px;font-size:10.5px;" data-action="wo-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-winner="B" title="하단 팀 기권승">하 W/O</button>
                    </span>
                  ` : ''}
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="bracket-round">
            <div class="bracket-round-title">${esc(r.name)}</div>
            <div class="bracket-matches">${matchesHtml}</div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${esc(activeGroup.name)} 토너먼트 대진표</h2>
            <p class="card-desc">총 ${activeGroup.teams.length}개 복식 팀 · 스코어 입력 시 승자가 다음 라운드로 자동 진출합니다.</p>
          </div>
          ${groupTabs}
        </div>
        <div class="bracket-scroll">
          <div class="bracket-grid">${roundsHtml}</div>
        </div>
      </div>
    `;
  }

  function renderIndividualMatches(t) {
    const groups = t.data.groups || [];
    if (!groups.length) return '<div class="card empty-state">생성된 개인전 그룹이 없습니다.</div>';

    const gIdx = Math.min(state.activeGroupTab, groups.length - 1);
    const activeGroup = groups[gIdx];

    const groupTabs = groups.length > 1
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${groups.map((g, idx) => `
            <button class="btn btn-sm ${idx === gIdx ? 'btn-primary' : ''}" data-action="switch-group-tab" data-idx="${idx}">
              ${esc(g.name)} (${g.players.length}명)
            </button>
          `).join('')}
        </div>`
      : '';

    const cardsHtml = activeGroup.matches
      .map((m) => {
        const isDone = m.status === 'completed' || m.status === 'walkover';
        const winA = isDone && m.scoreA > m.scoreB;
        const winB = isDone && m.scoreB > m.scoreA;
        return `
          <div class="match-card ${isDone ? 'completed' : ''}">
            <div class="match-card-top">
              <span><strong>Game ${m.order}</strong> · ${esc(activeGroup.name)}</span>
              <span>
                ${m.isMixedOverflow ? '<span class="badge badge-mixed">성별 보정</span>' : ''}
                ${isDone ? '<span class="badge badge-green">완료</span>' : '<span class="badge badge-neutral">진행대기</span>'}
              </span>
            </div>
            <div class="match-versus">
              <div class="mv-side ${winA ? 'winner' : ''}">
                <div class="mv-names">${esc(m.teamA.label)}</div>
                <div style="font-size:11px;color:var(--ink-muted);">실력합 ${m.teamA.weightSum}</div>
              </div>
              <div class="mv-center">
                <input type="number" min="0" max="99" class="score-box" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-individual" data-gid="${activeGroup.id}" data-mid="${m.id}" data-side="A" />
                <span style="font-weight:700;color:var(--ink-muted);">:</span>
                <input type="number" min="0" max="99" class="score-box" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-individual" data-gid="${activeGroup.id}" data-mid="${m.id}" data-side="B" />
              </div>
              <div class="mv-side ${winB ? 'winner' : ''}">
                <div class="mv-names">${esc(m.teamB.label)}</div>
                <div style="font-size:11px;color:var(--ink-muted);">실력합 ${m.teamB.weightSum}</div>
              </div>
            </div>
            ${m.note ? `<div style="font-size:11.5px;color:var(--clay);">${esc(m.note)}</div>` : ''}
          </div>
        `;
      })
      .join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${esc(activeGroup.name)} 파트너 교체 복식 경기 (${activeGroup.matches.length}경기)</h2>
            <p class="card-desc">참가자 ${activeGroup.players.length}명 · 목표 1인당 ${activeGroup.targetGamesPerPlayer}게임 · 파트너 중복 최소화 및 실력 밸런스 매칭</p>
          </div>
          ${groupTabs}
        </div>
        <div class="match-list">${cardsHtml}</div>
      </div>
    `;
  }

  function renderGroupMatches(t) {
    const groups = t.data.groups || [];
    const ties = t.data.ties || [];
    if (!groups.length) return '<div class="card empty-state">생성된 그룹전이 없습니다.</div>';

    const playerNameById = {};
    t.players.forEach((p) => (playerNameById[p.id] = `${p.name}(${p.skill})`));
    groups.forEach((g) => g.members.forEach((m) => (playerNameById[m.id] = `${m.name}(${m.skill})`)));

    const lineupCards = groups
      .map((g) => {
        const memberOpts = g.members
          .map((m) => `<option value="${m.id}">${esc(m.name)} (${E.genderLabel(m.gender)}·${esc(m.skill)})</option>`)
          .join('');

        // Count how many times each member appears in lineup
        const usage = {};
        g.lineup.forEach((slot) => {
          if (slot.p1Id) usage[slot.p1Id] = (usage[slot.p1Id] || 0) + 1;
          if (slot.p2Id) usage[slot.p2Id] = (usage[slot.p2Id] || 0) + 1;
        });

        const rows = g.lineup
          .map((slot, sIdx) => {
            const dupSame = slot.p1Id && slot.p1Id === slot.p2Id;
            return `
              <div class="lineup-row">
                <div style="font-weight:700;font-size:12.5px;color:var(--court-green);">제 ${slot.order}경기</div>
                <select class="select" style="padding:6px 8px;font-size:12.5px;" data-action="edit-lineup" data-gid="${g.id}" data-sidx="${sIdx}" data-slot="p1Id">
                  <option value="">-- 선수 1 --</option>
                  ${g.members.map((m) => `<option value="${m.id}" ${m.id === slot.p1Id ? 'selected' : ''}>${esc(m.name)} (${m.gender === 'F' ? '여' : '남'}·${esc(m.skill)})</option>`).join('')}
                </select>
                <select class="select" style="padding:6px 8px;font-size:12.5px;${dupSame ? 'border-color:var(--danger-text);' : ''}" data-action="edit-lineup" data-gid="${g.id}" data-sidx="${sIdx}" data-slot="p2Id">
                  <option value="">-- 선수 2 --</option>
                  ${g.members.map((m) => `<option value="${m.id}" ${m.id === slot.p2Id ? 'selected' : ''}>${esc(m.name)} (${m.gender === 'F' ? '여' : '남'}·${esc(m.skill)})</option>`).join('')}
                </select>
              </div>
            `;
          })
          .join('');

        return `
          <div class="card" style="margin-bottom:0;">
            <div class="card-header" style="margin-bottom:10px;">
              <div>
                <h3 class="card-title">${esc(g.name)} <span class="badge badge-neutral">평균 실력 ${g.avgWeight}</span></h3>
                <p class="card-desc">소속 ${g.members.length}명 · 남 ${g.members.filter((m) => m.gender === 'M').length} / 여 ${g.members.filter((m) => m.gender === 'F').length}</p>
              </div>
              <span class="badge ${g.lineupSubmitted ? 'badge-green' : 'badge-clay'}">${g.lineupSubmitted ? '오더 확정됨' : '대표 오더 입력'}</span>
            </div>

            <div class="form-row" style="margin-bottom:10px;">
              <div class="field">
                <label>그룹 대표 (주장)</label>
                <select class="select" style="padding:6px 8px;font-size:12.5px;" data-action="change-captain" data-gid="${g.id}">
                  ${g.members.map((m) => `<option value="${m.id}" ${m.id === g.captainId ? 'selected' : ''}>${esc(m.name)} (${esc(m.skill)})</option>`).join('')}
                </select>
              </div>
              <button class="btn btn-sm" data-action="auto-lineup" data-gid="${g.id}">✨ 자동 추천 오더</button>
              <button class="btn btn-primary btn-sm" data-action="confirm-lineup" data-gid="${g.id}">오더 확정</button>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:6px;">${rows}</div>

            <div style="margin-top:10px;display:flex;gap:5px;flex-wrap:wrap;">
              ${g.members.map((m) => `
                <span class="badge badge-neutral" style="font-size:11px;">${esc(m.name)}: ${usage[m.id] || 0}경기</span>
              `).join('')}
            </div>
          </div>
        `;
      })
      .join('');

    const tiesHtml = ties
      .map((tie) => {
        const gA = groups.find((g) => g.id === tie.groupAId);
        const gB = groups.find((g) => g.id === tie.groupBId);
        let winsA = 0, winsB = 0;
        tie.matches.forEach((m) => {
          if (m.status === 'completed' || m.status === 'walkover') {
            if (m.scoreA > m.scoreB) winsA++;
            else if (m.scoreB > m.scoreA) winsB++;
          }
        });

        const matchCards = tie.matches
          .map((m) => {
            const isDone = m.status === 'completed' || m.status === 'walkover';
            const winA = isDone && m.scoreA > m.scoreB;
            const winB = isDone && m.scoreB > m.scoreA;
            const labelA = m.teamAPlayers.map((id) => playerNameById[id] || '미정').join(' / ');
            const labelB = m.teamBPlayers.map((id) => playerNameById[id] || '미정').join(' / ');

            return `
              <div class="match-card ${isDone ? 'completed' : ''}">
                <div class="match-card-top">
                  <span><strong>제 ${m.order}복식</strong></span>
                  <span>${isDone ? '<span class="badge badge-green">완료</span>' : '<span class="badge badge-neutral">진행대기</span>'}</span>
                </div>
                <div class="match-versus">
                  <div class="mv-side ${winA ? 'winner' : ''}">
                    <div style="font-size:11px;color:var(--court-green);font-weight:700;">${esc(gA?.name)}</div>
                    <div class="mv-names">${esc(labelA)}</div>
                  </div>
                  <div class="mv-center">
                    <input type="number" min="0" max="99" class="score-box" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-group" data-tid="${tie.id}" data-mid="${m.id}" data-side="A" />
                    <span style="font-weight:700;color:var(--ink-muted);">:</span>
                    <input type="number" min="0" max="99" class="score-box" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-group" data-tid="${tie.id}" data-mid="${m.id}" data-side="B" />
                  </div>
                  <div class="mv-side ${winB ? 'winner' : ''}">
                    <div style="font-size:11px;color:var(--clay);font-weight:700;">${esc(gB?.name)}</div>
                    <div class="mv-names">${esc(labelB)}</div>
                  </div>
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="card">
            <div class="card-header">
              <div>
                <h3 class="card-title">대항전 #${tie.order}: ${esc(gA?.name)} vs ${esc(gB?.name)}</h3>
                <p class="card-desc">총 ${tie.matches.length}복식 진행</p>
              </div>
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--court-green);">
                ${winsA} : ${winsB}
              </div>
            </div>
            <div class="match-list">${matchCards}</div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">그룹별 대표 오더(출전 명단) 입력</h2>
            <p class="card-desc">각 그룹 대표가 게임 순서(1~${t.data.gamesPerTie}경기)에 맞춰 복식 조를 편성하고 [오더 확정]을 누르면 아래 대항전에 자동 반영됩니다.</p>
          </div>
        </div>
        <div class="grid-2">${lineupCards}</div>
      </div>
      ${tiesHtml}
    `;
  }

  function renderEventMatches(t) {
    const matches = (t.data && t.data.matches) || [];
    const cardsHtml = matches.length
      ? matches
          .map((m) => {
            const isDone = m.status === 'completed' || m.status === 'walkover';
            const winA = isDone && m.scoreA > m.scoreB;
            const winB = isDone && m.scoreB > m.scoreA;
            return `
              <div class="match-card ${isDone ? 'completed' : ''}">
                <div class="match-card-top">
                  <span><strong>Match #${m.order}</strong> · ${esc(m.formatLabel || '이벤트')}</span>
                  <span>${isDone ? '<span class="badge badge-green">완료</span>' : '<span class="badge badge-neutral">진행대기</span>'}</span>
                </div>
                <div class="match-versus">
                  <div class="mv-side ${winA ? 'winner' : ''}">
                    <div class="mv-names">${esc(m.teamA.label)}</div>
                  </div>
                  <div class="mv-center">
                    <input type="number" min="0" max="99" class="score-box" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-event" data-mid="${m.id}" data-side="A" />
                    <span style="font-weight:700;color:var(--ink-muted);">:</span>
                    <input type="number" min="0" max="99" class="score-box" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-event" data-mid="${m.id}" data-side="B" />
                  </div>
                  <div class="mv-side ${winB ? 'winner' : ''}">
                    <div class="mv-names">${esc(m.teamB.label)}</div>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')
      : '<div class="empty-state">아직 생성된 이벤트 경기가 없습니다. 아래 버튼으로 라운드를 추가하세요.</div>';

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">자유 이벤트 / 친선 믹스 매치 (${matches.length}경기)</h2>
            <p class="card-desc">휴식 인원을 우선 배정하여 공평하게 새 라운드를 계속 추가하거나, 원하는 조합으로 즉석 경기를 만들 수 있습니다.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" data-action="add-event-round">+ 다음 라운드 자동 매칭</button>
            <button class="btn btn-sm" data-action="open-manual-event">+ 수동 즉석 경기 추가</button>
          </div>
        </div>
        <div class="match-list">${cardsHtml}</div>
      </div>
    `;
  }

  // --- SECTION 4: STANDINGS ---
  function renderStandingsSection(t) {
    const blocks = computeStandingsBlocks(t);
    if (!blocks.length) {
      return `
        <div class="card empty-state">
          <div class="empty-state-icon">📊</div>
          <h3>집계할 경기 데이터가 없습니다</h3>
          <p>대진표를 생성하고 스코어를 입력하면 실시간 순위표가 표시됩니다.</p>
        </div>
      `;
    }

    const blocksHtml = blocks
      .map((b) => `
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${esc(b.title)}</h2>
              <p class="card-desc">승 +1점 · 무승부 0점 · 패 -1점 | 종합 동점 시 <strong>각 게임 스코어 총득점</strong> 우선 (동점 시 득실차 → 다승)</p>
            </div>
            <button class="btn btn-sm" data-action="export-results-excel">📥 결과 엑셀 내보내기</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="center" style="width:60px;">순위</th>
                  <th>선수 / 팀 / 그룹</th>
                  <th>구분</th>
                  <th class="num">경기수</th>
                  <th class="num">승</th>
                  <th class="num">무</th>
                  <th class="num">패</th>
                  <th class="num" style="color:var(--court-green);">승점</th>
                  <th class="num" style="color:var(--clay);">총득점</th>
                  <th class="num">총실점</th>
                  <th class="num">득실차</th>
                </tr>
              </thead>
              <tbody>
                ${b.rows.map((r) => `
                  <tr>
                    <td class="center">
                      <span class="rank-badge ${r.rank <= 3 ? 'rank-' + r.rank : ''}">${r.rank}</span>
                    </td>
                    <td><strong>${esc(r.name)}</strong></td>
                    <td><span class="badge badge-neutral">${esc(r.meta || '-')}</span></td>
                    <td class="num">${r.played}</td>
                    <td class="num">${r.wins}</td>
                    <td class="num">${r.draws}</td>
                    <td class="num">${r.losses}</td>
                    <td class="num" style="font-weight:700;color:var(--court-green);">${r.points > 0 ? '+' + r.points : r.points}</td>
                    <td class="num" style="font-weight:700;color:var(--clay);">${r.totalScored}</td>
                    <td class="num">${r.totalConceded}</td>
                    <td class="num">${r.scoreDiff > 0 ? '+' + r.scoreDiff : r.scoreDiff}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `)
      .join('');

    return blocksHtml;
  }

  // --- MODALS ---
  function renderModal(t) {
    if (!state.modal) return '';

    if (state.modal.type === 'new-tournament') {
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-box">
            <div class="modal-header">
              <h3 class="modal-title">🎾 새 테니스 대회 만들기</h3>
              <button class="btn btn-sm" data-action="close-modal">✕</button>
            </div>
            <form id="new-tournament-form">
              <div class="field" style="margin-bottom:12px;">
                <label>대회 이름</label>
                <input id="nt-name" class="input" type="text" placeholder="예: 11월 클럽 친선 복식대회" required />
              </div>
              <div class="field" style="margin-bottom:12px;">
                <label>대회 유형</label>
                <select id="nt-type" class="select">
                  <option value="tournament">🏆 토너먼트 (그룹별 토너먼트)</option>
                  <option value="individual">🔄 개인전 (KDK 파트너 교체 복식)</option>
                  <option value="group">🛡️ 그룹전 (균등 배분 + 그룹대표 오더 단체전)</option>
                  <option value="event">⚡ 이벤트 (자유 친선 / 믹스 / 타이브레이크)</option>
                </select>
              </div>
              <div class="field" style="margin-bottom:12px;">
                <label>기본 팀 구성</label>
                <select id="nt-team-mode" class="select">
                  <option value="mixed">혼성복식</option>
                  <option value="men">남성복식</option>
                  <option value="women">여성복식</option>
                </select>
              </div>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-secondary);cursor:pointer;">
                <input type="checkbox" id="nt-sample" checked />
                <span>테스트용 샘플 참가자 8명 미리 채우기</span>
              </label>
              <div class="modal-footer">
                <button type="button" class="btn" data-action="close-modal">취소</button>
                <button type="submit" class="btn btn-primary">대회 생성</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'skill-config' && t) {
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-box">
            <div class="modal-header">
              <h3 class="modal-title">⚙️ 실력등급 체계 설정</h3>
              <button class="btn btn-sm" data-action="close-modal">✕</button>
            </div>
            <div style="margin-bottom:14px;">
              <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;color:var(--ink-secondary);">프리셋 선택</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${Object.values(E.SKILL_PRESETS).map((pr) => `
                  <button class="btn btn-sm ${t.skillPresetId === pr.id ? 'btn-primary' : ''}" data-action="apply-skill-preset" data-preset="${pr.id}">
                    ${esc(pr.name)}
                  </button>
                `).join('')}
              </div>
            </div>
            <div style="font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--ink-secondary);">커스텀 등급 직접 입력 (한 줄에 "코드, 설명, 가중치" 형식)</div>
            <textarea id="custom-skill-text" class="input" rows="6" style="font-family:var(--font-mono);font-size:12.5px;">${t.skillLevels.map((l) => `${l.code}, ${l.label}, ${l.weight}`).join('\n')}</textarea>
            <div class="modal-footer">
              <button class="btn" data-action="close-modal">닫기</button>
              <button class="btn btn-primary" data-action="save-custom-skills">등급 저장</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'incident' && t) {
      const activePlayers = E.getActivePlayers(t.players);
      const prePid = state.modal.payload?.pid || (activePlayers[0] ? activePlayers[0].id : '');
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-box">
            <div class="modal-header">
              <h3 class="modal-title">🚨 갑작스런 불참 / 대체 선수 처리</h3>
              <button class="btn btn-sm" data-action="close-modal">✕</button>
            </div>
            <div class="field" style="margin-bottom:12px;">
              <label>불참 / 기권 선수 선택</label>
              <select id="inc-player" class="select">
                ${activePlayers.map((p) => `<option value="${p.id}" ${p.id === prePid ? 'selected' : ''}>${esc(p.name)} (${E.genderLabel(p.gender)}·${esc(p.skill)})</option>`).join('')}
              </select>
            </div>

            <div class="card" style="padding:14px;background:var(--bg-subtle);margin-bottom:12px;">
              <div style="font-weight:700;font-size:13.5px;margin-bottom:8px;">방법 1. 대체 선수(게스트) 즉시 투입</div>
              <div class="form-row">
                <div class="field">
                  <label>대체 선수 이름</label>
                  <input id="inc-sub-name" class="input" type="text" placeholder="예: 김대타" />
                </div>
                <div class="field" style="max-width:90px;">
                  <label>성별</label>
                  <select id="inc-sub-gender" class="select"><option value="M">남성</option><option value="F">여성</option></select>
                </div>
                <div class="field" style="max-width:110px;">
                  <label>등급</label>
                  <select id="inc-sub-skill" class="select">
                    ${t.skillLevels.map((l) => `<option value="${esc(l.code)}">${esc(l.code)}</option>`).join('')}
                  </select>
                </div>
              </div>
              <button class="btn btn-primary btn-sm" style="margin-top:10px;" data-action="exec-substitute">대체 선수 투입 (미진행 경기 자동 교체)</button>
            </div>

            <div class="card" style="padding:14px;background:var(--danger-bg);border-color:var(--danger-border);margin-bottom:0;">
              <div style="font-weight:700;font-size:13.5px;color:var(--danger-text);margin-bottom:6px;">방법 2. 불참 기권(W/O) 처리</div>
              <p style="margin:0 0 10px;font-size:12.5px;color:var(--ink-secondary);">해당 선수의 남은 미진행 경기를 상대방 기권승(W/O)으로 처리하고, 토너먼트인 경우 상대를 다음 라운드로 자동 진출시킵니다.</p>
              <button class="btn btn-danger-soft btn-sm" data-action="exec-walkover">불참 확정 및 남은 경기 기권(W/O) 처리</button>
            </div>

            <div class="modal-footer">
              <button class="btn" data-action="close-modal">닫기</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'manual-event' && t) {
      const activePlayers = E.getActivePlayers(t.players);
      const opts = activePlayers.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.gender === 'F' ? '여' : '남'}·${esc(p.skill)})</option>`).join('');
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-box">
            <div class="modal-header">
              <h3 class="modal-title">⚡ 수동 즉석 이벤트 경기 추가</h3>
              <button class="btn btn-sm" data-action="close-modal">✕</button>
            </div>
            <form id="manual-event-form">
              <div class="grid-2" style="margin-bottom:12px;">
                <div class="field"><label>A팀 선수 1</label><select id="me-a1" class="select">${opts}</select></div>
                <div class="field"><label>A팀 선수 2</label><select id="me-a2" class="select">${opts}</select></div>
                <div class="field"><label>B팀 선수 1</label><select id="me-b1" class="select">${opts}</select></div>
                <div class="field"><label>B팀 선수 2</label><select id="me-b2" class="select">${opts}</select></div>
              </div>
              <div class="field">
                <label>경기 방식 메모</label>
                <input id="me-label" class="input" type="text" value="7점 타이브레이크 친선전" />
              </div>
              <div class="modal-footer">
                <button type="button" class="btn" data-action="close-modal">취소</button>
                <button type="submit" class="btn btn-primary">경기 추가</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    return '';
  }

  // --- Event Binding ---
  function bindEvents(t) {
    // Click delegation
    document.getElementById('app').onclick = function (e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const act = target.dataset.action;

      if (act === 'close-modal-backdrop' && e.target !== target) return;

      switch (act) {
        case 'switch-tournament':
          state.activeTournamentId = target.dataset.id;
          state.activeGroupTab = 0;
          saveState();
          render();
          break;
        case 'switch-section':
          state.activeSection = target.dataset.sec;
          render();
          break;
        case 'switch-group-tab':
          state.activeGroupTab = Number(target.dataset.idx) || 0;
          render();
          break;
        case 'open-new-tournament':
          state.modal = { type: 'new-tournament' };
          render();
          break;
        case 'open-skill-config':
          state.modal = { type: 'skill-config' };
          render();
          break;
        case 'open-incident':
          state.modal = { type: 'incident', payload: { pid: target.dataset.pid } };
          render();
          break;
        case 'open-manual-event':
          state.modal = { type: 'manual-event' };
          render();
          break;
        case 'close-modal':
        case 'close-modal-backdrop':
          state.modal = null;
          render();
          break;
        case 'delete-tournament':
          if (!t) return;
          if (confirm(`"${t.name}" 대회 탭을 삭제하시겠습니까?`)) {
            state.tournaments = state.tournaments.filter((x) => x.id !== t.id);
            state.activeTournamentId = state.tournaments[0]?.id || null;
            saveState();
            render();
            toast('대회가 삭제되었습니다.');
          }
          break;
        case 'remove-player':
          if (!t) return;
          t.players = t.players.filter((p) => p.id !== target.dataset.pid);
          saveState();
          render();
          break;
        case 'restore-player':
          if (!t) return;
          const rp = t.players.find((p) => p.id === target.dataset.pid);
          if (rp) rp.status = 'active';
          saveState();
          render();
          toast('선수가 참가 상태로 복귀했습니다.');
          break;
        case 'add-sample-players':
          if (!t) return;
          t.players.push(...makeSampleRoster(8));
          saveState();
          render();
          toast('샘플 참가자 8명이 추가되었습니다.');
          break;
        case 'clear-players':
          if (!t) return;
          if (confirm('참가자 명단을 모두 비우시겠습니까?')) {
            t.players = [];
            t.data = null;
            t.warnings = [];
            saveState();
            render();
          }
          break;
        case 'download-excel-template':
          downloadExcelTemplate();
          break;
        case 'export-backup':
          exportBackupJSON();
          break;
        case 'open-backup-import':
          document.getElementById('json-backup-input')?.click();
          break;
        case 'export-results-excel':
          exportResultsExcel();
          break;
        case 'set-type':
          if (!t) return;
          t.type = target.dataset.val;
          if (t.type === 'group' && t.config.groupCount < 2) t.config.groupCount = 2;
          saveState();
          render();
          break;
        case 'set-team-mode':
          if (!t) return;
          t.config.teamMode = target.dataset.val;
          saveState();
          render();
          break;
        case 'generate-draw':
          generateDrawForActive();
          break;
        case 'add-event-round':
          addEventRound();
          break;
        case 'wo-tournament': {
          if (!t || !t.data) return;
          const g = t.data.groups.find((x) => x.id === target.dataset.gid);
          const r = g?.rounds[Number(target.dataset.ridx)];
          const m = r?.matches.find((x) => x.id === target.dataset.mid);
          if (m) {
            const wo = (E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad']).walkoverScore;
            if (target.dataset.winner === 'A') {
              m.scoreA = wo; m.scoreB = 0; m.winnerSide = 'A';
            } else {
              m.scoreA = 0; m.scoreB = wo; m.winnerSide = 'B';
            }
            m.status = 'walkover';
            m.note = '기권승 (W/O)';
            E.propagateBracketWinners(g.rounds);
            saveState();
            render();
            toast('기권승(W/O) 처리 및 다음 라운드 진출이 반영되었습니다.');
          }
          break;
        }
        case 'auto-lineup': {
          if (!t || !t.data) return;
          const g = t.data.groups.find((x) => x.id === target.dataset.gid);
          if (g) {
            g.lineup = E.buildAutoLineupForGroup(g.members, t.data.gamesPerTie, t.config.teamMode);
            syncGroupLineupToTies(t, g.id);
            saveState();
            render();
            toast(`${g.name} 추천 오더가 자동 채워졌습니다.`);
          }
          break;
        }
        case 'confirm-lineup': {
          if (!t || !t.data) return;
          const g = t.data.groups.find((x) => x.id === target.dataset.gid);
          if (g) {
            g.lineupSubmitted = true;
            syncGroupLineupToTies(t, g.id);
            saveState();
            render();
            toast(`${g.name} 오더가 확정되어 대항전에 반영되었습니다.`);
          }
          break;
        }
        case 'apply-skill-preset': {
          if (!t) return;
          const pr = E.SKILL_PRESETS[target.dataset.preset];
          if (pr) {
            t.skillPresetId = pr.id;
            t.skillLevels = JSON.parse(JSON.stringify(pr.levels));
            saveState();
            render();
            toast(`${pr.name} 등급 체계가 적용되었습니다.`);
          }
          break;
        }
        case 'save-custom-skills': {
          if (!t) return;
          const txt = document.getElementById('custom-skill-text')?.value || '';
          const parsed = txt
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((line, i, arr) => {
              const parts = line.split(',').map((s) => s.trim());
              return {
                code: parts[0] || `L${i + 1}`,
                label: parts[1] || parts[0] || `L${i + 1}`,
                weight: Number(parts[2]) || (arr.length - i),
              };
            });
          if (parsed.length > 0) {
            t.skillPresetId = 'custom';
            t.skillLevels = parsed;
            state.modal = null;
            saveState();
            render();
            toast('커스텀 실력등급 체계가 저장되었습니다.');
          }
          break;
        }
        case 'exec-substitute': {
          if (!t) return;
          const oldId = document.getElementById('inc-player')?.value;
          const subName = (document.getElementById('inc-sub-name')?.value || '').trim();
          const subGender = document.getElementById('inc-sub-gender')?.value || 'M';
          const subSkill = document.getElementById('inc-sub-skill')?.value || t.skillLevels[0].code;
          if (!oldId || !subName) {
            toast('대체 선수 이름을 입력하세요.');
            return;
          }
          const oldP = t.players.find((p) => p.id === oldId);
          if (oldP) oldP.status = 'withdrawn';
          const newP = { id: E.uid('p'), name: subName, gender: subGender, skill: subSkill, status: 'active' };
          t.players.push(newP);
          const count = E.substitutePlayerInTournament(t, oldId, newP);
          state.modal = null;
          saveState();
          render();
          toast(`${subName} 선수로 대체 완료 (미진행 경기 ${count}건 자동 반영).`);
          break;
        }
        case 'exec-walkover': {
          if (!t) return;
          const pid = document.getElementById('inc-player')?.value;
          if (!pid) return;
          const p = t.players.find((x) => x.id === pid);
          if (p) p.status = 'withdrawn';
          const woScore = (E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad']).walkoverScore;
          const affected = E.walkoverPlayerInTournament(t, pid, woScore);
          state.modal = null;
          saveState();
          render();
          toast(`${p?.name || '선수'} 불참 처리 및 미진행 ${affected}경기 기권승(W/O) 반영 완료.`);
          break;
        }
      }
    };

    // Change / Input delegation
    document.getElementById('app').onchange = function (e) {
      const el = e.target;
      if (!t && el.id !== 'json-backup-input') return;

      if (el.id === 'json-backup-input') {
        importBackupJSON(el.files[0]);
        return;
      }
      if (el.id === 'excel-file-input') {
        handleFileImport(el.files[0]);
        return;
      }
      if (el.id === 'tournament-name-input') {
        t.name = el.value.trim() || t.name;
        saveState();
        render();
        return;
      }
      if (el.id === 'chk-mixed-overflow') {
        t.config.allowMixedOverflow = el.checked;
        saveState();
        return;
      }
      if (el.id === 'cfg-match-format') { t.config.matchFormat = el.value; saveState(); render(); return; }
      if (el.id === 'cfg-group-count') { t.config.groupCount = Number(el.value); saveState(); render(); return; }
      if (el.id === 'cfg-group-mode') { t.config.groupMode = el.value; saveState(); return; }
      if (el.id === 'cfg-pairing-strategy') { t.config.pairingStrategy = el.value; saveState(); return; }
      if (el.id === 'cfg-games-per-player') { t.config.gamesPerPlayer = Number(el.value); saveState(); return; }
      if (el.id === 'cfg-games-per-tie') { t.config.gamesPerTie = Number(el.value); saveState(); return; }
      if (el.id === 'cfg-event-format') { t.config.eventFormat = el.value; saveState(); return; }

      const act = el.dataset.action;
      if (act === 'change-player-skill') {
        const p = t.players.find((x) => x.id === el.dataset.pid);
        if (p) { p.skill = el.value; saveState(); render(); }
      } else if (act === 'score-tournament') {
        const g = t.data.groups.find((x) => x.id === el.dataset.gid);
        const m = g?.rounds[Number(el.dataset.ridx)]?.matches.find((x) => x.id === el.dataset.mid);
        if (m) updateScore(m, el.dataset.side, el.value, t);
      } else if (act === 'score-individual') {
        const g = t.data.groups.find((x) => x.id === el.dataset.gid);
        const m = g?.matches.find((x) => x.id === el.dataset.mid);
        if (m) updateScore(m, el.dataset.side, el.value, t);
      } else if (act === 'score-group') {
        const tie = t.data.ties.find((x) => x.id === el.dataset.tid);
        const m = tie?.matches.find((x) => x.id === el.dataset.mid);
        if (m) updateScore(m, el.dataset.side, el.value, t);
      } else if (act === 'score-event') {
        const m = t.data.matches.find((x) => x.id === el.dataset.mid);
        if (m) updateScore(m, el.dataset.side, el.value, t);
      } else if (act === 'change-captain') {
        const g = t.data.groups.find((x) => x.id === el.dataset.gid);
        if (g) { g.captainId = el.value; saveState(); }
      } else if (act === 'edit-lineup') {
        const g = t.data.groups.find((x) => x.id === el.dataset.gid);
        const slot = g?.lineup[Number(el.dataset.sidx)];
        if (slot) {
          slot[el.dataset.slot] = el.value || null;
          g.lineupSubmitted = false;
          syncGroupLineupToTies(t, g.id);
          saveState();
          render();
        }
      }
    };

    // Forms
    const addForm = document.getElementById('add-player-form');
    if (addForm && t) {
      addForm.onsubmit = function (e) {
        e.preventDefault();
        const name = document.getElementById('p-name').value.trim();
        if (!name) return;
        const gender = document.getElementById('p-gender').value;
        const skill = document.getElementById('p-skill').value;
        t.players.push({ id: E.uid('p'), name, gender, skill, status: 'active' });
        saveState();
        render();
        document.getElementById('p-name')?.focus();
      };
    }

    const ntForm = document.getElementById('new-tournament-form');
    if (ntForm) {
      ntForm.onsubmit = function (e) {
        e.preventDefault();
        const name = document.getElementById('nt-name').value.trim() || '새 테니스 대회';
        const type = document.getElementById('nt-type').value;
        const teamMode = document.getElementById('nt-team-mode').value;
        const withSample = document.getElementById('nt-sample').checked;
        const newT = createTournamentObject({
          name,
          type,
          players: withSample ? makeSampleRoster(8) : [],
          config: { teamMode, groupCount: type === 'group' ? 2 : 1 },
        });
        state.tournaments.push(newT);
        state.activeTournamentId = newT.id;
        state.activeSection = 'roster';
        state.modal = null;
        saveState();
        render();
        toast(`"${name}" 대회가 생성되었습니다.`);
      };
    }

    const meForm = document.getElementById('manual-event-form');
    if (meForm && t) {
      meForm.onsubmit = function (e) {
        e.preventDefault();
        const ids = ['me-a1', 'me-a2', 'me-b1', 'me-b2'].map((id) => document.getElementById(id).value);
        const byId = {};
        t.players.forEach((p) => (byId[p.id] = p));
        if (!t.data) t.data = { matches: [], resting: [] };
        t.data.matches.push({
          id: E.uid('em'),
          order: t.data.matches.length + 1,
          formatLabel: document.getElementById('me-label').value.trim() || '이벤트',
          teamA: {
            players: [ids[0], ids[1]],
            names: [byId[ids[0]]?.name || '', byId[ids[1]]?.name || ''],
            label: `${byId[ids[0]]?.name || ''} / ${byId[ids[1]]?.name || ''}`,
          },
          teamB: {
            players: [ids[2], ids[3]],
            names: [byId[ids[2]]?.name || '', byId[ids[3]]?.name || ''],
            label: `${byId[ids[2]]?.name || ''} / ${byId[ids[3]]?.name || ''}`,
          },
          scoreA: null,
          scoreB: null,
          status: 'pending',
          note: '',
        });
        state.modal = null;
        saveState();
        render();
        toast('즉석 이벤트 경기가 추가되었습니다.');
      };
    }

    // Excel Dropzone drag & click
    const dz = document.getElementById('excel-dropzone');
    const fileInput = document.getElementById('excel-file-input');
    if (dz && fileInput) {
      dz.onclick = () => fileInput.click();
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
      dz.ondragleave = () => dz.classList.remove('dragover');
      dz.ondrop = (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileImport(e.dataTransfer.files[0]);
        }
      };
    }
  }

  // --- Boot ---
  loadState();
  render();
})();
