(function () {
  'use strict';

  const E = window.TennisEngine;
  const STORAGE_KEY = 'matchpoint_tennis_app_v2';

  let state = {
    tournaments: [],
    activeTournamentId: null,
    activeSection: 'matches', // 'roster' | 'setup' | 'matches' | 'standings'
    activeGroupTab: 0,
    modal: null,
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 2600);
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
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('courtflow_tennis_app_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0) {
          parsed.tournaments.forEach((tr) => {
            if (tr.name === '클럽 대항 그룹전') tr.name = '클럽 대항 단체전';
          });
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
      case 'tournament': return { icon: 'emoji_events', label: '토너먼트' };
      case 'individual': return { icon: 'sync_alt', label: '개인전(KDK)' };
      case 'group': return { icon: 'shield', label: '단체전' };
      case 'event': return { icon: 'bolt', label: '이벤트' };
      default: return { icon: 'sports_tennis', label: '대회' };
    }
  }

  function getTournamentProgress(t) {
    let total = 0, done = 0;
    if (!t.data) return { total: 0, done: 0, pct: 0, statusLabel: '접수중' };

    const countMatch = (m) => {
      if (m.status !== 'bye') {
        total++;
        if (m.status === 'completed' || m.status === 'walkover') done++;
      }
    };

    if (t.type === 'tournament') (t.data.groups || []).forEach((g) => g.rounds.forEach((r) => r.matches.forEach(countMatch)));
    else if (t.type === 'individual') (t.data.groups || []).forEach((g) => g.matches.forEach(countMatch));
    else if (t.type === 'group') (t.data.ties || []).forEach((tie) => tie.matches.forEach(countMatch));
    else if (t.type === 'event') (t.data.matches || []).forEach(countMatch);

    const pct = total ? Math.round((done / total) * 100) : 0;
    const statusLabel = total === 0 ? '대진전' : done === total ? '완료' : `${done}/${total}`;
    return { total, done, pct, statusLabel };
  }

  function makeSampleRoster(count) {
    const pool = [
      ['김서연', 'F', 'A'], ['김민수', 'M', 'A'], ['박준혁', 'M', 'B'], ['최수진', 'F', 'B'],
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
    const t1 = createTournamentObject({
      name: '매치포인트 봄 토너먼트',
      type: 'tournament',
      players: makeSampleRoster(12),
      config: { teamMode: 'mixed', pairingStrategy: 'balanced', groupCount: 1, groupMode: 'skill-tier', matchFormat: '6game-noad' },
    });
    const r1 = E.generateTournament(t1.players, { ...t1.config, levels: t1.skillLevels });
    t1.data = { groups: r1.groups, teams: r1.teams, leftovers: r1.leftovers };
    t1.warnings = r1.warnings;
    const fp = t1.data.groups[0]?.rounds[0]?.matches.find((m) => m.status === 'pending');
    if (fp) {
      fp.scoreA = 6; fp.scoreB = 3; fp.status = 'completed'; fp.winnerSide = 'A';
      E.propagateBracketWinners(t1.data.groups[0].rounds);
    }

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
      t2.data.groups[0].matches[0].scoreA = 6; t2.data.groups[0].matches[0].scoreB = 4; t2.data.groups[0].matches[0].status = 'completed';
      t2.data.groups[0].matches[1].scoreA = 5; t2.data.groups[0].matches[1].scoreB = 5; t2.data.groups[0].matches[1].status = 'completed';
    }

    const t3 = createTournamentObject({
      name: '클럽 대항 단체전',
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
    if (res.newMatches.length > 0) toast(`이벤트 경기 ${res.newMatches.length}개 추가됨`);
  }

  function syncGroupLineupToTies(t, groupId) {
    if (!t.data?.groups || !t.data?.ties) return;
    const grp = t.data.groups.find((g) => g.id === groupId);
    if (!grp) return;
    t.data.ties.forEach((tie) => {
      tie.matches.forEach((m, idx) => {
        if (m.status !== 'pending') return;
        const slot = grp.lineup[idx];
        if (!slot) return;
        if (tie.groupAId === groupId) m.teamAPlayers = [slot.p1Id, slot.p2Id];
        if (tie.groupBId === groupId) m.teamBPlayers = [slot.p1Id, slot.p2Id];
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
        matchRef.status = 'pending';
        matchRef.winnerSide = null;
        matchRef.note = '토너먼트는 동점 불가 (승자 입력)';
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
    } else if (matchRef.status !== 'bye') {
      matchRef.status = 'pending';
      if (tournament.type === 'tournament') matchRef.winnerSide = null;
    }

    if (tournament.type === 'tournament' && tournament.data?.groups) {
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
          const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          importRosterRows(t, rows);
        } catch (err) {
          toast('파일 읽기 오류: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = function (evt) {
        const lines = String(evt.target.result || '').split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) return toast('CSV 데이터가 비어 있습니다.');
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
      const findVal = (pats) => {
        const k = keys.find((key) => pats.some((p) => key.toLowerCase().includes(p)));
        return k ? String(row[k]).trim() : '';
      };
      const name = findVal(['이름', '성명', '선수', '참가자', 'name']);
      if (!name) return;
      t.players.push({
        id: E.uid('p'),
        name,
        gender: E.normalizeGender(findVal(['성별', 'gender', 'sex'])),
        skill: findVal(['실력', '등급', '레벨', 'ntrp', '부서', 'skill', 'level', 'grade']) || defaultSkill,
        status: 'active',
      });
      added++;
    });
    if (added > 0) { saveState(); render(); toast(`참가자 ${added}명이 추가되었습니다.`); }
    else toast('유효한 참가자 행을 찾지 못했습니다.');
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadExcelTemplate() {
    const t = getActiveTournament();
    const lvls = (t && t.skillLevels) || E.SKILL_PRESETS.abcde.levels;
    const sample = [
      { 이름: '김서연', 성별: '여', 실력등급: lvls[0]?.code || 'A' },
      { 이름: '김민수', 성별: '남', 실력등급: lvls[0]?.code || 'A' },
      { 이름: '박준혁', 성별: '남', 실력등급: lvls[1]?.code || 'B' },
      { 이름: '최수진', 성별: '여', 실력등급: lvls[2]?.code || 'C' },
    ];
    if (window.XLSX) {
      const ws = window.XLSX.utils.json_to_sheet(sample);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '참가자명단');
      window.XLSX.writeFile(wb, '매치포인트_참가자_업로드양식.xlsx');
      toast('엑셀 양식(.xlsx) 다운로드 완료');
    } else {
      const csv = '\uFEFF이름,성별,실력등급\n' + sample.map((r) => `${r.이름},${r.성별},${r.실력등급}`).join('\n');
      downloadBlob(csv, '매치포인트_참가자_업로드양식.csv', 'text/csv;charset=utf-8');
      toast('CSV 양식 다운로드 완료');
    }
  }

  function exportBackupJSON() {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tournaments: state.tournaments }, null, 2);
    downloadBlob(payload, `matchpoint_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('전체 대회 데이터 백업 완료');
  }

  function importBackupJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed && Array.isArray(parsed.tournaments) && parsed.tournaments.length) {
          state.tournaments = parsed.tournaments;
          state.activeTournamentId = parsed.tournaments[0].id;
          saveState(); render();
          toast(`대회 ${parsed.tournaments.length}개 복원 완료`);
        } else toast('올바른 백업 JSON 파일이 아닙니다.');
      } catch (err) { toast('복원 오류: ' + err.message); }
    };
    reader.readAsText(file, 'utf-8');
  }

  function computeStandingsBlocks(t) {
    if (!t || !t.data) return [];
    if (t.type === 'tournament' && t.data.groups) {
      return t.data.groups.map((g) => {
        const entities = g.teams.map((tm) => ({ id: tm.id, name: tm.name, meta: tm.isMixedOverflow ? '혼성보정' : E.teamTypeLabel(tm.division) }));
        const matches = [];
        g.rounds.forEach((r) => r.matches.forEach((m) => {
          if ((m.status === 'completed' || m.status === 'walkover') && m.teamA && m.teamB) {
            matches.push({ sideAIds: [m.teamA.id], sideBIds: [m.teamB.id], scoreA: m.scoreA, scoreB: m.scoreB, status: m.status });
          }
        }));
        return { title: `${g.name} 팀 순위`, rows: E.computeStandings(entities, matches) };
      });
    }
    if (t.type === 'individual' && t.data.groups) {
      return t.data.groups.map((g) => {
        const entities = g.players.map((p) => ({ id: p.id, name: p.name, meta: `${p.gender === 'F' ? '여' : '남'}·${p.skill}` }));
        const matches = g.matches.map((m) => ({ sideAIds: m.teamA.players, sideBIds: m.teamB.players, scoreA: m.scoreA, scoreB: m.scoreB, status: m.status }));
        return { title: `${g.name} 개인 순위`, rows: E.computeStandings(entities, matches) };
      });
    }
    if (t.type === 'group' && t.data.groups) {
      const grpEntities = t.data.groups.map((g) => ({ id: g.id, name: g.name, meta: `${g.members.length}명` }));
      const grpMatches = [], playerMatches = [], allPlayers = [];
      t.data.groups.forEach((g) => g.members.forEach((m) => allPlayers.push({ id: m.id, name: m.name, meta: `${g.name}·${m.skill}` })));
      (t.data.ties || []).forEach((tie) => tie.matches.forEach((m) => {
        grpMatches.push({ sideAIds: [tie.groupAId], sideBIds: [tie.groupBId], scoreA: m.scoreA, scoreB: m.scoreB, status: m.status });
        playerMatches.push({ sideAIds: m.teamAPlayers.filter(Boolean), sideBIds: m.teamBPlayers.filter(Boolean), scoreA: m.scoreA, scoreB: m.scoreB, status: m.status });
      }));
      return [
        { title: '그룹 종합 순위', rows: E.computeStandings(grpEntities, grpMatches) },
        { title: '개인 기여도 순위', rows: E.computeStandings(allPlayers, playerMatches) },
      ];
    }
    if (t.type === 'event' && t.data.matches) {
      const entities = t.players.map((p) => ({ id: p.id, name: p.name, meta: `${p.gender === 'F' ? '여' : '남'}·${p.skill}` }));
      const matches = t.data.matches.map((m) => ({ sideAIds: m.teamA.players, sideBIds: m.teamB.players, scoreA: m.scoreA, scoreB: m.scoreB, status: m.status }));
      return [{ title: '이벤트 종합 순위', rows: E.computeStandings(entities, matches) }];
    }
    return [];
  }

  function exportResultsExcel() {
    const t = getActiveTournament();
    if (!t) return;
    const rows = [];
    computeStandingsBlocks(t).forEach((b) => b.rows.forEach((r) => rows.push({
      구분: b.title, 순위: r.rank, 이름: r.name, 경기수: r.played, 승: r.wins, 무: r.draws, 패: r.losses,
      승점: r.points, 총득점: r.totalScored, 총실점: r.totalConceded, 득실차: r.scoreDiff,
    })));
    if (!rows.length) return toast('내보낼 순위 데이터가 없습니다.');
    if (window.XLSX) {
      const ws = window.XLSX.utils.json_to_sheet(rows);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '순위표');
      window.XLSX.writeFile(wb, `${t.name}_결과순위표.xlsx`);
      toast('결과 엑셀(.xlsx) 내보내기 완료');
    } else {
      const h = Object.keys(rows[0]);
      const csv = '\uFEFF' + h.join(',') + '\n' + rows.map((r) => h.map((k) => `"${r[k]}"`).join(',')).join('\n');
      downloadBlob(csv, `${t.name}_결과순위표.csv`, 'text/csv;charset=utf-8');
    }
  }

  // ==================== RENDER (STITCH MOBILE SHELL) ====================
  function render() {
    const app = document.getElementById('app');
    if (!app) return;
    const t = getActiveTournament();

    app.innerHTML = `
      <div class="mobile-shell">
        ${renderTopBar()}
        <main class="mp-main">
          ${renderTournamentStrip(t)}
          ${t ? renderActiveTournamentBody(t) : renderEmptyState()}
        </main>
        ${renderBottomNav()}
      </div>
      ${renderModal(t)}
      <div id="toast-container" class="toast-container"></div>
      <input type="file" id="json-backup-input" accept=".json" style="display:none" />
    `;

    bindEvents(t);
  }

  function renderTopBar() {
    return `
      <header class="mp-header">
        <div class="mp-header-inner">
          <div class="mp-brand">
            <div class="mp-logo-badge">
              <span class="material-symbols-outlined icon-fill" style="font-size:20px;">sports_tennis</span>
            </div>
            <div style="display:flex;flex-direction:column;min-width:0;">
              <span class="mp-brand-ko">매치포인트</span>
              <span class="mp-brand-en">MATCHPOINT TC</span>
            </div>
          </div>
          <div class="mp-header-actions">
            <button class="icon-btn" data-action="open-backup-menu" aria-label="데이터 백업 및 복원" title="데이터 백업/복원">
              <span class="material-symbols-outlined">cloud_sync</span>
            </button>
            <button class="icon-btn" data-action="open-new-tournament" aria-label="새 대회 만들기" title="새 대회 만들기">
              <span class="material-symbols-outlined">add_circle</span>
              <span class="volt-dot" style="position:absolute;top:8px;right:8px;"></span>
            </button>
          </div>
        </div>
      </header>
    `;
  }

  function renderTournamentStrip(activeT) {
    return `
      <div class="t-strip" role="tablist" aria-label="진행 중인 대회 탭">
        ${state.tournaments.map((x) => {
          const meta = typeMeta(x.type);
          const prog = getTournamentProgress(x);
          const isAct = activeT && x.id === activeT.id;
          return `
            <button class="t-pill ${isAct ? 'active' : ''}" data-action="switch-tournament" data-id="${x.id}">
              <span class="material-symbols-outlined" style="font-size:16px;">${meta.icon}</span>
              <span>${esc(x.name)}</span>
              <span class="t-pill-prog">${esc(prog.statusLabel)}</span>
            </button>
          `;
        }).join('')}
        <button class="t-pill t-pill-add" data-action="open-new-tournament">
          <span class="material-symbols-outlined" style="font-size:16px;">add</span>
          <span>새 대회</span>
        </button>
      </div>
    `;
  }

  function renderBottomNav() {
    const items = [
      { id: 'roster', icon: 'group', label: '명단접수' },
      { id: 'setup', icon: 'tune', label: '대회설정' },
      { id: 'matches', icon: 'sports_tennis', label: '스코어보드' },
      { id: 'standings', icon: 'emoji_events', label: '순위표' },
    ];
    return `
      <nav class="mp-bottom-nav" aria-label="하단 메뉴">
        <div class="mp-bottom-inner">
          ${items.map((it) => `
            <button class="nav-item ${state.activeSection === it.id ? 'active' : ''}" data-action="switch-section" data-sec="${it.id}">
              <span class="material-symbols-outlined">${it.icon}</span>
              <span class="nav-label">${it.label}</span>
            </button>
          `).join('')}
        </div>
      </nav>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="mp-card" style="text-align:center;padding:36px 20px;">
        <span class="material-symbols-outlined" style="font-size:40px;color:var(--primary);margin-bottom:8px;">sports_tennis</span>
        <h2 style="margin:0 0 6px;font-family:var(--font-display);font-size:18px;">진행 중인 대회가 없습니다</h2>
        <p style="margin:0 0 16px;font-size:13px;color:var(--on-surface-variant);">새 테니스 대회를 만들어 참가자 접수와 대진표를 시작하세요.</p>
        <button class="btn btn-primary" data-action="open-new-tournament">+ 새 대회 만들기</button>
      </div>
    `;
  }

  function renderActiveTournamentBody(t) {
    const meta = typeMeta(t.type);
    const activeP = E.getActivePlayers(t.players);
    const men = activeP.filter((p) => p.gender === 'M').length;
    const women = activeP.filter((p) => p.gender === 'F').length;
    const prog = getTournamentProgress(t);
    const fmt = E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad'];

    return `
      <!-- Stitch-style Hero Summary Card -->
      <section class="mp-card" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
              <span class="pill pill-primary">
                <span class="material-symbols-outlined" style="font-size:13px;">${meta.icon}</span>
                ${meta.label}
              </span>
              <span class="pill pill-soft">${E.teamTypeLabel(t.config.teamMode)}</span>
            </div>
            <input id="tournament-name-input" type="text" value="${esc(t.name)}" aria-label="대회 이름"
              style="width:100%;border:none;background:transparent;font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--on-surface);padding:2px 0;outline:none;" />
          </div>
          <button class="icon-btn" data-action="delete-tournament" title="현재 대회 삭제" style="color:var(--error);">
            <span class="material-symbols-outlined" style="font-size:20px;">delete_outline</span>
          </button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-low);padding:9px 12px;border-radius:10px;gap:8px;">
          <div style="display:flex;align-items:center;gap:7px;min-width:0;">
            <span class="volt-dot"></span>
            <span style="font-size:12px;font-weight:600;color:var(--on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(fmt.label)}
            </span>
          </div>
          <span style="font-family:var(--font-score);font-size:11px;font-weight:700;color:var(--secondary);white-space:nowrap;">승+1 · 무0 · 패-1</span>
        </div>
      </section>

      <!-- Stitch 3-Metric Summary Row -->
      <section class="metrics-grid">
        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-label">참가 인원</span>
            <span class="material-symbols-outlined" style="font-size:17px;color:var(--primary);">groups</span>
          </div>
          <div class="metric-val">${activeP.length}명</div>
          <span class="metric-foot">남 ${men} · 여 ${women}</span>
        </div>
        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-label">진행률</span>
            <span class="material-symbols-outlined" style="font-size:17px;color:var(--secondary);">pie_chart</span>
          </div>
          <div class="metric-val">${prog.pct}%</div>
          <span class="metric-foot">${prog.done} / ${prog.total}경기</span>
        </div>
        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-label">불참/부상</span>
            <span class="material-symbols-outlined" style="font-size:17px;color:var(--primary);">health_and_safety</span>
          </div>
          <div class="metric-val">${t.players.length - activeP.length}명</div>
          <button style="border:none;background:none;padding:0;text-align:left;font-size:11px;font-weight:700;color:var(--secondary);cursor:pointer;" data-action="open-incident">대체·기권 관리 ›</button>
        </div>
      </section>

      ${state.activeSection === 'roster' ? renderRosterSection(t) : ''}
      ${state.activeSection === 'setup' ? renderSetupSection(t) : ''}
      ${state.activeSection === 'matches' ? renderMatchesSection(t) : ''}
      ${state.activeSection === 'standings' ? renderStandingsSection(t) : ''}
    `;
  }

  // --- 1. ROSTER ---
  function renderRosterSection(t) {
    const levelOpts = t.skillLevels.map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join('');

    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">person_add</span>
            직접 참가자 등록
          </h2>
          <button class="btn btn-soft btn-sm" data-action="open-skill-config">등급 설정</button>
        </div>
        <form id="add-player-form" style="display:flex;flex-direction:column;gap:10px;">
          <div class="field">
            <label for="p-name">참가자 이름</label>
            <input id="p-name" class="input" type="text" placeholder="예: 홍길동" required />
          </div>
          <div class="option-grid-2">
            <div class="field">
              <label for="p-gender">성별</label>
              <select id="p-gender" class="select">
                <option value="M">남성</option>
                <option value="F">여성</option>
              </select>
            </div>
            <div class="field">
              <label for="p-skill">실력등급</label>
              <select id="p-skill" class="select">${levelOpts}</select>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-full">+ 명단에 추가</button>
        </form>
      </section>

      <section class="mp-card">
        <div class="mp-card-header">
          <div>
            <h2 class="mp-card-title">
              <span class="material-symbols-outlined" style="color:var(--primary);">upload_file</span>
              엑셀 / CSV 일괄 업로드
            </h2>
            <p class="mp-card-sub">이름 · 성별(남/여) · 실력등급 컬럼 자동 인식</p>
          </div>
          <button class="btn btn-soft btn-sm" data-action="download-excel-template">양식 받기</button>
        </div>
        <div id="excel-dropzone" class="dropzone">
          <span class="material-symbols-outlined" style="font-size:28px;color:var(--primary);margin-bottom:4px;">table_view</span>
          <div style="font-weight:700;font-size:13.5px;color:var(--on-surface);">터치하여 엑셀(.xlsx) 또는 CSV 선택</div>
          <div style="font-size:11.5px;color:var(--on-surface-variant);margin-top:2px;">등급: ${esc(t.skillLevels.map((l) => l.code).join(' / '))}</div>
          <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" style="display:none" />
        </div>
      </section>

      <section class="mp-card">
        <div class="mp-card-header">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">format_list_bulleted</span>
            접수 명단 (${t.players.length}명)
          </h2>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-soft btn-sm" data-action="add-sample-players">+샘플 8명</button>
            <button class="btn btn-danger btn-sm" data-action="clear-players">초기화</button>
          </div>
        </div>

        <div class="list-stack">
          ${t.players.length ? t.players.map((p, idx) => {
            const w = p.status === 'withdrawn';
            return `
              <div class="list-row ${w ? 'withdrawn' : ''}">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                  <div class="res-circle ${p.gender === 'F' ? 'res-D' : 'res-W'}" style="width:30px;height:30px;font-size:11.5px;">
                    ${idx + 1}
                  </div>
                  <div style="min-width:0;">
                    <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:5px;">
                      <span>${esc(p.name)}</span>
                      <span class="pill ${p.gender === 'F' ? 'pill-women' : 'pill-men'}" style="padding:2px 7px;font-size:10.5px;">${p.gender === 'F' ? '여' : '남'}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                  <select class="select select-sm" style="width:auto;min-width:74px;" data-action="change-player-skill" data-pid="${p.id}">
                    ${t.skillLevels.map((l) => `<option value="${esc(l.code)}" ${l.code === p.skill ? 'selected' : ''}>${esc(l.code)}</option>`).join('')}
                  </select>
                  ${w
                    ? `<button class="btn btn-soft btn-sm" data-action="restore-player" data-pid="${p.id}">복귀</button>`
                    : `<button class="icon-btn" style="width:32px;height:32px;" data-action="open-incident" data-pid="${p.id}" title="불참/부상 대체"><span class="material-symbols-outlined" style="font-size:18px;">swap_horiz</span></button>`}
                  <button class="icon-btn" style="width:32px;height:32px;color:var(--error);" data-action="remove-player" data-pid="${p.id}" title="삭제">
                    <span class="material-symbols-outlined" style="font-size:18px;">close</span>
                  </button>
                </div>
              </div>
            `;
          }).join('') : `<div style="text-align:center;padding:24px;color:var(--on-surface-variant);font-size:13px;">등록된 참가자가 없습니다.</div>`}
        </div>

        <button class="btn btn-primary btn-full" style="margin-top:14px;" data-action="switch-section" data-sec="setup">
          다음: 대회 설정 & 대진 생성
          <span class="material-symbols-outlined" style="font-size:18px;">arrow_forward</span>
        </button>
      </section>
    `;
  }

  // --- 2. SETUP & DRAW ---
  function renderSetupSection(t) {
    const activeCount = E.getActivePlayers(t.players).length;
    const perGroupEst = Math.floor(activeCount / Math.max(1, t.config.groupCount));
    const indRec = E.recommendIndividualGames(perGroupEst);
    const grpRec = E.recommendGroupGames(activeCount, t.config.groupCount);

    const types = [
      { id: 'tournament', icon: 'emoji_events', title: '토너먼트', sub: '그룹별 브래킷 + BYE 자동' },
      { id: 'individual', icon: 'sync_alt', title: '개인전(KDK)', sub: '파트너 교체 복식 로테이션' },
      { id: 'group', icon: 'shield', title: '단체전', sub: '균등 배분 + 대표 오더 입력' },
      { id: 'event', icon: 'bolt', title: '이벤트 매치', sub: '자유 친선 · 타이브레이크' },
    ];

    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">category</span>
            대회 유형 (복식 전용)
          </h2>
        </div>
        <div class="option-grid-2">
          ${types.map((tp) => `
            <button class="opt-card ${t.type === tp.id ? 'selected' : ''}" data-action="set-type" data-val="${tp.id}">
              <div class="opt-card-title">
                <span class="material-symbols-outlined" style="font-size:18px;">${tp.icon}</span>
                ${tp.title}
              </div>
              <div class="opt-card-sub">${tp.sub}</div>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="mp-card">
        <div class="mp-card-header">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">diversity_3</span>
            팀 구성 & 밸런스 보정
          </h2>
        </div>
        <div class="option-grid-3" style="margin-bottom:12px;">
          ${[['men', '남성복식'], ['women', '여성복식'], ['mixed', '혼성복식']].map(([id, label]) => `
            <button class="opt-card ${t.config.teamMode === id ? 'selected' : ''}" style="text-align:center;padding:11px 8px;" data-action="set-team-mode" data-val="${id}">
              <div class="opt-card-title" style="justify-content:center;font-size:13px;">${label}</div>
            </button>
          `).join('')}
        </div>

        <div class="list-row">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span class="volt-dot"></span>
            <span style="font-size:12.5px;font-weight:600;color:var(--on-surface);">홀수·성비 불균형 시 혼성 보정팀 허용</span>
          </div>
          <button type="button" class="mp-switch ${t.config.allowMixedOverflow ? 'on' : ''}" data-action="toggle-mixed-overflow" aria-checked="${t.config.allowMixedOverflow}" role="switch">
            <span class="mp-switch-knob"></span>
          </button>
        </div>
      </section>

      <section class="mp-card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="mp-card-header" style="margin-bottom:0;">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">tune</span>
            세부 경기 설정 (${activeCount}명)
          </h2>
        </div>

        <div class="field">
          <label for="cfg-match-format">테니스 공식 경기 규칙</label>
          <select id="cfg-match-format" class="select">
            ${Object.values(E.MATCH_FORMATS).map((f) => `<option value="${f.id}" ${t.config.matchFormat === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
          </select>
        </div>

        ${t.type !== 'event' ? `
          <div class="option-grid-2">
            <div class="field">
              <label for="cfg-group-count">생성 그룹 수</label>
              <select id="cfg-group-count" class="select">
                ${(t.type === 'group' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4]).map((n) => `<option value="${n}" ${Number(t.config.groupCount) === n ? 'selected' : ''}>${n}개 그룹</option>`).join('')}
              </select>
            </div>
            ${(t.type === 'tournament' || t.type === 'individual') ? `
              <div class="field">
                <label for="cfg-group-mode">그룹 배분 기준</label>
                <select id="cfg-group-mode" class="select">
                  <option value="skill-tier" ${t.config.groupMode === 'skill-tier' ? 'selected' : ''}>실력등급별 그룹</option>
                  <option value="balanced" ${t.config.groupMode === 'balanced' ? 'selected' : ''}>균등 밸런스 배분</option>
                </select>
              </div>
            ` : `
              <div class="field">
                <label for="cfg-games-per-tie">대항전 복식 수</label>
                <select id="cfg-games-per-tie" class="select">
                  ${[1, 2, 3, 4, 5, 6, 7].map((g) => `<option value="${g}" ${Number(t.config.gamesPerTie) === g ? 'selected' : ''}>${g}복식 ${g === grpRec.recommended ? '(추천)' : ''}</option>`).join('')}
                </select>
              </div>
            `}
          </div>
        ` : ''}

        ${t.type === 'tournament' ? `
          <div class="field">
            <label for="cfg-pairing-strategy">복식 페어링 전략</label>
            <select id="cfg-pairing-strategy" class="select">
              <option value="balanced" ${t.config.pairingStrategy === 'balanced' ? 'selected' : ''}>밸런스 조합 (상위 + 하위 실력 평준화)</option>
              <option value="similar" ${t.config.pairingStrategy === 'similar' ? 'selected' : ''}>동급 조합 (비슷한 실력끼리 페어)</option>
            </select>
          </div>
        ` : ''}

        ${t.type === 'individual' ? `
          <div class="field">
            <label for="cfg-games-per-player">1인당 적정 게임수</label>
            <select id="cfg-games-per-player" class="select">
              ${[2, 3, 4, 5, 6].map((g) => `<option value="${g}" ${Number(t.config.gamesPerPlayer) === g ? 'selected' : ''}>${g}게임 ${g === indRec.recommended ? '(추천)' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="alert-box alert-info"><strong>추천 안내:</strong> ${esc(indRec.reason)}</div>
        ` : ''}

        ${t.type === 'group' ? `<div class="alert-box alert-info"><strong>추천 안내:</strong> ${esc(grpRec.reason)}</div>` : ''}

        <button class="btn btn-volt btn-full" style="padding:13px;" data-action="generate-draw" ${activeCount < 4 ? 'disabled' : ''}>
          <span class="material-symbols-outlined">sports_tennis</span>
          대진표 자동 생성 (${activeCount}명)
        </button>
      </section>
    `;
  }

  // --- 3. MATCHES & LIVE SCOREBOARD ---
  function renderMatchesSection(t) {
    if (!t.data) {
      return `
        <div class="mp-card" style="text-align:center;padding:34px 18px;">
          <span class="material-symbols-outlined" style="font-size:36px;color:var(--primary);margin-bottom:6px;">event_note</span>
          <h3 style="margin:0 0 6px;font-family:var(--font-display);">아직 대진표가 없습니다</h3>
          <p style="margin:0 0 14px;font-size:13px;color:var(--on-surface-variant);">[대회설정] 탭에서 옵션을 확인하고 대진표를 생성하세요.</p>
          <button class="btn btn-primary" data-action="switch-section" data-sec="setup">대회 설정으로 이동</button>
        </div>
      `;
    }

    const warningsHtml = (t.warnings && t.warnings.length)
      ? `<div class="alert-box alert-warn"><strong>⚠️ 밸런스 보정 안내</strong>${t.warnings.map((w) => `<div style="margin-top:3px;">• ${esc(w)}</div>`).join('')}</div>`
      : '';

    let bodyHtml = '';
    if (t.type === 'tournament') bodyHtml = renderTournamentMatches(t);
    else if (t.type === 'individual') bodyHtml = renderIndividualMatches(t);
    else if (t.type === 'group') bodyHtml = renderGroupMatches(t);
    else if (t.type === 'event') bodyHtml = renderEventMatches(t);

    return `${warningsHtml}${bodyHtml}`;
  }

  function renderTournamentMatches(t) {
    const groups = t.data.groups || [];
    if (!groups.length) return '';
    const gIdx = Math.min(state.activeGroupTab, groups.length - 1);
    const activeGroup = groups[gIdx];

    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <div>
            <h2 class="mp-card-title">
              <span class="material-symbols-outlined" style="color:var(--primary);">account_tree</span>
              ${esc(activeGroup.name)} 토너먼트
            </h2>
            <p class="mp-card-sub">좌우로 스와이프하여 라운드별 대진을 확인하세요</p>
          </div>
          ${groups.length > 1 ? `
            <div style="display:flex;gap:4px;">
              ${groups.map((g, i) => `<button class="btn btn-sm ${i === gIdx ? 'btn-primary' : 'btn-soft'}" data-action="switch-group-tab" data-idx="${i}">${esc(g.name)}</button>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="bracket-scroll">
          ${activeGroup.rounds.map((r) => `
            <div class="bracket-col">
              <div class="bracket-col-head">${esc(r.name)}</div>
              ${r.matches.map((m) => {
                const isBye = m.status === 'bye';
                const isDone = m.status === 'completed' || m.status === 'walkover';
                const canEdit = !isBye && m.teamA && m.teamB;
                return `
                  <div class="match-card ${isDone ? 'done' : ''}" style="${isBye ? 'border:1.5px dashed var(--outline-variant);opacity:0.8;' : ''}">
                    <div class="match-head">
                      <span>${esc(r.name)} #${m.matchIndex + 1}</span>
                      <span style="color:${isDone ? 'var(--secondary)' : 'var(--on-surface-variant)'};">
                        ${m.note ? esc(m.note) : (isDone ? '완료' : (canEdit ? '진행대기' : '대기'))}
                      </span>
                    </div>
                    <div class="match-team-row ${m.winnerSide === 'A' ? 'winner' : ''}">
                      <div class="match-team-name">
                        ${m.teamA ? esc(m.teamA.name) : '대기 중'}
                        ${m.teamA?.isMixedOverflow ? ' <span class="pill pill-mixed" style="padding:1px 5px;font-size:10px;">혼성보정</span>' : ''}
                      </div>
                      ${canEdit ? `<input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-side="A" />` : ''}
                    </div>
                    <div class="match-team-row ${m.winnerSide === 'B' ? 'winner' : ''}">
                      <div class="match-team-name">
                        ${m.teamB ? esc(m.teamB.name) : (isBye ? 'BYE (부전승)' : '대기 중')}
                        ${m.teamB?.isMixedOverflow ? ' <span class="pill pill-mixed" style="padding:1px 5px;font-size:10px;">혼성보정</span>' : ''}
                      </div>
                      ${canEdit ? `<input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-side="B" />` : ''}
                    </div>
                    ${canEdit && !isDone ? `
                      <div style="display:flex;justify-content:flex-end;gap:6px;">
                        <button class="btn btn-soft btn-sm" style="padding:4px 8px;font-size:11px;" data-action="wo-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-winner="A">상단 W/O</button>
                        <button class="btn btn-soft btn-sm" style="padding:4px 8px;font-size:11px;" data-action="wo-tournament" data-gid="${activeGroup.id}" data-ridx="${r.roundIndex}" data-mid="${m.id}" data-winner="B">하단 W/O</button>
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderIndividualMatches(t) {
    const groups = t.data.groups || [];
    if (!groups.length) return '';
    const gIdx = Math.min(state.activeGroupTab, groups.length - 1);
    const activeGroup = groups[gIdx];

    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <div>
            <h2 class="mp-card-title">
              <span class="material-symbols-outlined" style="color:var(--primary);">sync_alt</span>
              ${esc(activeGroup.name)} KDK 복식 경기
            </h2>
            <p class="mp-card-sub">${activeGroup.players.length}명 · 1인 목표 ${activeGroup.targetGamesPerPlayer}게임 · 총 ${activeGroup.matches.length}경기</p>
          </div>
          ${groups.length > 1 ? `
            <div style="display:flex;gap:4px;">
              ${groups.map((g, i) => `<button class="btn btn-sm ${i === gIdx ? 'btn-primary' : 'btn-soft'}" data-action="switch-group-tab" data-idx="${i}">${esc(g.name)}</button>`).join('')}
            </div>
          ` : ''}
        </div>
        <div class="list-stack">
          ${activeGroup.matches.map((m) => {
            const done = m.status === 'completed' || m.status === 'walkover';
            const wA = done && m.scoreA > m.scoreB;
            const wB = done && m.scoreB > m.scoreA;
            return `
              <div class="match-card ${done ? 'done' : ''}">
                <div class="match-head">
                  <span>GAME ${m.order}</span>
                  <span>
                    ${m.isMixedOverflow ? '<span class="pill pill-mixed" style="padding:1px 6px;font-size:10px;margin-right:4px;">성별보정</span>' : ''}
                    ${done ? '<span class="pill pill-primary" style="padding:1px 7px;font-size:10px;">완료</span>' : '스코어 입력'}
                  </span>
                </div>
                <div class="match-team-row ${wA ? 'winner' : ''}">
                  <div class="match-team-name">${esc(m.teamA.label)}</div>
                  <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-individual" data-gid="${activeGroup.id}" data-mid="${m.id}" data-side="A" />
                </div>
                <div class="match-team-row ${wB ? 'winner' : ''}">
                  <div class="match-team-name">${esc(m.teamB.label)}</div>
                  <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-individual" data-gid="${activeGroup.id}" data-mid="${m.id}" data-side="B" />
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderGroupMatches(t) {
    const groups = t.data.groups || [];
    const ties = t.data.ties || [];
    const pMap = {};
    t.players.forEach((p) => (pMap[p.id] = `${p.name}(${p.skill})`));
    groups.forEach((g) => g.members.forEach((m) => (pMap[m.id] = `${m.name}(${m.skill})`)));

    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <div>
            <h2 class="mp-card-title">
              <span class="material-symbols-outlined" style="color:var(--primary);">assignment_ind</span>
              그룹 대표 오더 입력
            </h2>
            <p class="mp-card-sub">각 그룹 대표가 1~${t.data.gamesPerTie}경기 복식 조를 지정합니다</p>
          </div>
        </div>
        <div class="list-stack">
          ${groups.map((g) => `
            <div style="background:var(--surface-low);border-radius:14px;padding:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;">
                <div>
                  <strong style="font-size:14px;color:var(--primary);">${esc(g.name)}</strong>
                  <span class="pill pill-soft" style="margin-left:4px;">평균 ${g.avgWeight}</span>
                </div>
                <div style="display:flex;gap:5px;">
                  <button class="btn btn-soft btn-sm" data-action="auto-lineup" data-gid="${g.id}">자동추천</button>
                  <button class="btn btn-primary btn-sm" data-action="confirm-lineup" data-gid="${g.id}">${g.lineupSubmitted ? '확정 ✓' : '오더확정'}</button>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:11.5px;font-weight:600;color:var(--on-surface-variant);white-space:nowrap;">그룹 대표</span>
                <select class="select select-sm" data-action="change-captain" data-gid="${g.id}">
                  ${g.members.map((m) => `<option value="${m.id}" ${m.id === g.captainId ? 'selected' : ''}>${esc(m.name)} (${esc(m.skill)})</option>`).join('')}
                </select>
              </div>
              ${g.lineup.map((slot, sIdx) => `
                <div class="lineup-row">
                  <span style="font-family:var(--font-score);font-size:11.5px;font-weight:700;color:var(--primary);">제${slot.order}경기</span>
                  <select class="select select-sm" data-action="edit-lineup" data-gid="${g.id}" data-sidx="${sIdx}" data-slot="p1Id">
                    ${g.members.map((m) => `<option value="${m.id}" ${m.id === slot.p1Id ? 'selected' : ''}>${esc(m.name)}(${m.gender === 'F' ? '여' : '남'}·${esc(m.skill)})</option>`).join('')}
                  </select>
                  <select class="select select-sm" data-action="edit-lineup" data-gid="${g.id}" data-sidx="${sIdx}" data-slot="p2Id">
                    ${g.members.map((m) => `<option value="${m.id}" ${m.id === slot.p2Id ? 'selected' : ''}>${esc(m.name)}(${m.gender === 'F' ? '여' : '남'}·${esc(m.skill)})</option>`).join('')}
                  </select>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </section>

      ${ties.map((tie) => {
        const gA = groups.find((g) => g.id === tie.groupAId);
        const gB = groups.find((g) => g.id === tie.groupBId);
        let wA = 0, wB = 0;
        tie.matches.forEach((m) => {
          if (m.status === 'completed' || m.status === 'walkover') {
            if (m.scoreA > m.scoreB) wA++; else if (m.scoreB > m.scoreA) wB++;
          }
        });
        return `
          <section class="mp-card">
            <div class="mp-card-header">
              <h3 class="mp-card-title">${esc(gA?.name)} vs ${esc(gB?.name)}</h3>
              <span class="pill pill-primary" style="font-size:13px;padding:4px 12px;">${wA} : ${wB}</span>
            </div>
            <div class="list-stack">
              ${tie.matches.map((m) => {
                const done = m.status === 'completed' || m.status === 'walkover';
                const labelA = m.teamAPlayers.map((id) => pMap[id] || '미정').join(' / ');
                const labelB = m.teamBPlayers.map((id) => pMap[id] || '미정').join(' / ');
                return `
                  <div class="match-card ${done ? 'done' : ''}">
                    <div class="match-head"><span>제 ${m.order}복식</span><span>${done ? '완료' : '진행대기'}</span></div>
                    <div class="match-team-row ${done && m.scoreA > m.scoreB ? 'winner' : ''}">
                      <div class="match-team-name"><span style="font-size:11px;color:var(--primary);margin-right:4px;">${esc(gA?.name)}</span>${esc(labelA)}</div>
                      <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-group" data-tid="${tie.id}" data-mid="${m.id}" data-side="A" />
                    </div>
                    <div class="match-team-row ${done && m.scoreB > m.scoreA ? 'winner' : ''}">
                      <div class="match-team-name"><span style="font-size:11px;color:var(--secondary);margin-right:4px;">${esc(gB?.name)}</span>${esc(labelB)}</div>
                      <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-group" data-tid="${tie.id}" data-mid="${m.id}" data-side="B" />
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </section>
        `;
      }).join('')}
    `;
  }

  function renderEventMatches(t) {
    const matches = (t.data && t.data.matches) || [];
    return `
      <section class="mp-card">
        <div class="mp-card-header">
          <h2 class="mp-card-title">
            <span class="material-symbols-outlined" style="color:var(--primary);">bolt</span>
            이벤트 매치 (${matches.length})
          </h2>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-volt btn-sm" data-action="add-event-round">+ 자동 매칭</button>
            <button class="btn btn-soft btn-sm" data-action="open-manual-event">+ 수동</button>
          </div>
        </div>
        <div class="list-stack">
          ${matches.length ? matches.map((m) => {
            const done = m.status === 'completed' || m.status === 'walkover';
            return `
              <div class="match-card ${done ? 'done' : ''}">
                <div class="match-head"><span>MATCH #${m.order}</span><span>${esc(m.formatLabel || '이벤트')}</span></div>
                <div class="match-team-row ${done && m.scoreA > m.scoreB ? 'winner' : ''}">
                  <div class="match-team-name">${esc(m.teamA.label)}</div>
                  <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreA != null ? m.scoreA : ''}" placeholder="-" data-action="score-event" data-mid="${m.id}" data-side="A" />
                </div>
                <div class="match-team-row ${done && m.scoreB > m.scoreA ? 'winner' : ''}">
                  <div class="match-team-name">${esc(m.teamB.label)}</div>
                  <input type="number" inputmode="numeric" min="0" max="99" class="score-input" value="${m.scoreB != null ? m.scoreB : ''}" placeholder="-" data-action="score-event" data-mid="${m.id}" data-side="B" />
                </div>
              </div>
            `;
          }).join('') : `<div style="text-align:center;padding:24px;color:var(--on-surface-variant);">[+ 자동 매칭] 버튼을 눌러 경기를 추가하세요.</div>`}
        </div>
      </section>
    `;
  }

  // --- 4. STANDINGS ---
  function renderStandingsSection(t) {
    const blocks = computeStandingsBlocks(t);
    if (!blocks.length) {
      return `<div class="mp-card" style="text-align:center;padding:34px 18px;color:var(--on-surface-variant);">대진표를 생성하고 스코어를 입력하면 순위표가 집계됩니다.</div>`;
    }

    return blocks.map((b) => `
      <section class="mp-card">
        <div class="mp-card-header">
          <div>
            <h2 class="mp-card-title">
              <span class="material-symbols-outlined" style="color:var(--secondary);">military_tech</span>
              ${esc(b.title)}
            </h2>
            <p class="mp-card-sub">승 +1 · 무 0 · 패 -1 | 동점 시 총득점 우선</p>
          </div>
          <button class="btn btn-soft btn-sm" data-action="export-results-excel">엑셀 저장</button>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>순위</th>
                <th>선수 / 팀</th>
                <th class="num">승-무-패</th>
                <th class="num">승점</th>
                <th class="num">총득점</th>
                <th class="num">득실</th>
              </tr>
            </thead>
            <tbody>
              ${b.rows.map((r) => `
                <tr>
                  <td>
                    <span class="pill ${r.rank === 1 ? 'pill-primary' : r.rank <= 3 ? 'pill-green-soft' : 'pill-soft'}" style="padding:3px 8px;">
                      ${r.rank === 1 ? '🏆 1' : r.rank === 2 ? '🥈 2' : r.rank === 3 ? '🥉 3' : r.rank}
                    </span>
                  </td>
                  <td>
                    <div style="font-weight:700;color:var(--on-surface);">${esc(r.name)}</div>
                    <div style="font-size:11px;color:var(--on-surface-variant);">${esc(r.meta)}</div>
                  </td>
                  <td class="num" style="font-size:12px;">${r.wins}-${r.draws}-${r.losses}</td>
                  <td class="num" style="font-weight:700;font-size:14px;color:var(--primary);">${r.points > 0 ? '+' + r.points : r.points}</td>
                  <td class="num" style="font-weight:700;color:var(--secondary);">${r.totalScored}</td>
                  <td class="num" style="font-size:12px;color:var(--on-surface-variant);">${r.scoreDiff > 0 ? '+' + r.scoreDiff : r.scoreDiff}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `).join('');
  }

  // --- MODALS (Bottom Sheet Style) ---
  function renderModal(t) {
    if (!state.modal) return '';

    if (state.modal.type === 'backup-menu') {
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-sheet">
            <div class="modal-head">
              <h3 class="modal-title">데이터 백업 및 복원</h3>
              <button class="icon-btn" data-action="close-modal"><span class="material-symbols-outlined">close</span></button>
            </div>
            <p style="font-size:13px;color:var(--on-surface-variant);margin:0 0 14px;">현재 기기에 저장된 모든 대회 명단·대진표·스코어를 JSON 파일로 백업하거나 다른 기기에서 복원할 수 있습니다.</p>
            <div class="list-stack">
              <button class="btn btn-primary btn-full" data-action="export-backup">
                <span class="material-symbols-outlined">download</span>
                전체 대회 JSON 백업 다운로드
              </button>
              <button class="btn btn-soft btn-full" data-action="open-backup-import">
                <span class="material-symbols-outlined">upload</span>
                백업 JSON 파일 불러오기 (복원)
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'new-tournament') {
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-sheet">
            <div class="modal-head">
              <h3 class="modal-title">새 테니스 대회 만들기</h3>
              <button class="icon-btn" data-action="close-modal"><span class="material-symbols-outlined">close</span></button>
            </div>
            <form id="new-tournament-form" style="display:flex;flex-direction:column;gap:12px;">
              <div class="field">
                <label>대회 이름</label>
                <input id="nt-name" class="input" type="text" placeholder="예: 11월 클럽 친선 복식대회" required />
              </div>
              <div class="field">
                <label>대회 유형</label>
                <select id="nt-type" class="select">
                  <option value="tournament">토너먼트 (그룹별 브래킷)</option>
                  <option value="individual">개인전 (KDK 파트너 교체)</option>
                  <option value="group">단체전 (대표 오더)</option>
                  <option value="event">이벤트 (자유 친선 · 타이브레이크)</option>
                </select>
              </div>
              <div class="field">
                <label>기본 팀 구성</label>
                <select id="nt-team-mode" class="select">
                  <option value="mixed">혼성복식</option>
                  <option value="men">남성복식</option>
                  <option value="women">여성복식</option>
                </select>
              </div>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--on-surface-variant);">
                <input type="checkbox" id="nt-sample" checked />
                <span>테스트용 샘플 참가자 8명 미리 채우기</span>
              </label>
              <button type="submit" class="btn btn-primary btn-full" style="margin-top:4px;">대회 생성하기</button>
            </form>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'skill-config' && t) {
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-sheet">
            <div class="modal-head">
              <h3 class="modal-title">실력등급 체계 설정</h3>
              <button class="icon-btn" data-action="close-modal"><span class="material-symbols-outlined">close</span></button>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
              ${Object.values(E.SKILL_PRESETS).map((pr) => `
                <button class="btn btn-sm ${t.skillPresetId === pr.id ? 'btn-primary' : 'btn-soft'}" data-action="apply-skill-preset" data-preset="${pr.id}">${esc(pr.name)}</button>
              `).join('')}
            </div>
            <div class="field" style="margin-bottom:12px;">
              <label>커스텀 등급 (한 줄에 "코드, 설명, 가중치")</label>
              <textarea id="custom-skill-text" class="textarea" rows="5" style="font-family:var(--font-score);font-size:12.5px;">${t.skillLevels.map((l) => `${l.code}, ${l.label}, ${l.weight}`).join('\n')}</textarea>
            </div>
            <button class="btn btn-primary btn-full" data-action="save-custom-skills">등급 저장 완료</button>
          </div>
        </div>
      `;
    }

    if (state.modal.type === 'incident' && t) {
      const activePlayers = E.getActivePlayers(t.players);
      const prePid = state.modal.payload?.pid || (activePlayers[0]?.id || '');
      return `
        <div class="modal-backdrop" data-action="close-modal-backdrop">
          <div class="modal-sheet">
            <div class="modal-head">
              <h3 class="modal-title">불참 · 부상 / 대체 처리</h3>
              <button class="icon-btn" data-action="close-modal"><span class="material-symbols-outlined">close</span></button>
            </div>
            <div class="field" style="margin-bottom:12px;">
              <label>대상 선수 선택</label>
              <select id="inc-player" class="select">
                ${activePlayers.map((p) => `<option value="${p.id}" ${p.id === prePid ? 'selected' : ''}>${esc(p.name)} (${E.genderLabel(p.gender)}·${esc(p.skill)})</option>`).join('')}
              </select>
            </div>
            <div style="background:var(--surface-low);border-radius:14px;padding:12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px;">
              <strong style="font-size:13px;color:var(--primary);">방법 1. 대체 선수(게스트) 즉시 투입</strong>
              <input id="inc-sub-name" class="input input-sm" type="text" placeholder="대체 선수 이름" />
              <div class="option-grid-2">
                <select id="inc-sub-gender" class="select select-sm"><option value="M">남성</option><option value="F">여성</option></select>
                <select id="inc-sub-skill" class="select select-sm">${t.skillLevels.map((l) => `<option value="${esc(l.code)}">${esc(l.code)}</option>`).join('')}</select>
              </div>
              <button class="btn btn-primary btn-sm btn-full" data-action="exec-substitute">대체 투입 (미진행 경기 자동 교체)</button>
            </div>
            <div style="background:var(--error-container);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;">
              <strong style="font-size:13px;color:var(--error);">방법 2. 불참 기권(W/O) 처리</strong>
              <p style="margin:0;font-size:12px;color:#7f1d1d;">남은 미진행 경기를 상대방 기권승 처리하고 토너먼트 진출자를 자동 반영합니다.</p>
              <button class="btn btn-danger btn-sm btn-full" style="background:var(--error);color:#fff;" data-action="exec-walkover">불참 및 기권(W/O) 확정</button>
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
          <div class="modal-sheet">
            <div class="modal-head">
              <h3 class="modal-title">수동 즉석 이벤트 경기</h3>
              <button class="icon-btn" data-action="close-modal"><span class="material-symbols-outlined">close</span></button>
            </div>
            <form id="manual-event-form" style="display:flex;flex-direction:column;gap:10px;">
              <div class="option-grid-2">
                <div class="field"><label>A팀 선수 1</label><select id="me-a1" class="select select-sm">${opts}</select></div>
                <div class="field"><label>A팀 선수 2</label><select id="me-a2" class="select select-sm">${opts}</select></div>
                <div class="field"><label>B팀 선수 1</label><select id="me-b1" class="select select-sm">${opts}</select></div>
                <div class="field"><label>B팀 선수 2</label><select id="me-b2" class="select select-sm">${opts}</select></div>
              </div>
              <div class="field"><label>경기 메모</label><input id="me-label" class="input input-sm" value="7점 타이브레이크 친선전" /></div>
              <button type="submit" class="btn btn-primary btn-full">경기 추가</button>
            </form>
          </div>
        </div>
      `;
    }

    return '';
  }

  // --- EVENTS ---
  function bindEvents(t) {
    document.getElementById('app').onclick = function (e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const act = target.dataset.action;
      if (act === 'close-modal-backdrop' && e.target !== target) return;

      switch (act) {
        case 'switch-tournament':
          state.activeTournamentId = target.dataset.id;
          state.activeGroupTab = 0;
          saveState(); render();
          break;
        case 'switch-section':
          state.activeSection = target.dataset.sec;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          render();
          break;
        case 'switch-group-tab':
          state.activeGroupTab = Number(target.dataset.idx) || 0;
          render();
          break;
        case 'open-new-tournament': state.modal = { type: 'new-tournament' }; render(); break;
        case 'open-backup-menu': state.modal = { type: 'backup-menu' }; render(); break;
        case 'open-skill-config': state.modal = { type: 'skill-config' }; render(); break;
        case 'open-incident': state.modal = { type: 'incident', payload: { pid: target.dataset.pid } }; render(); break;
        case 'open-manual-event': state.modal = { type: 'manual-event' }; render(); break;
        case 'close-modal':
        case 'close-modal-backdrop':
          state.modal = null; render(); break;
        case 'delete-tournament':
          if (t && confirm(`"${t.name}" 대회를 삭제할까요?`)) {
            state.tournaments = state.tournaments.filter((x) => x.id !== t.id);
            state.activeTournamentId = state.tournaments[0]?.id || null;
            saveState(); render(); toast('대회 삭제됨');
          }
          break;
        case 'remove-player':
          if (t) { t.players = t.players.filter((p) => p.id !== target.dataset.pid); saveState(); render(); }
          break;
        case 'restore-player':
          if (t) { const p = t.players.find((x) => x.id === target.dataset.pid); if (p) p.status = 'active'; saveState(); render(); toast('복귀 처리됨'); }
          break;
        case 'add-sample-players':
          if (t) { t.players.push(...makeSampleRoster(8)); saveState(); render(); toast('샘플 8명 추가됨'); }
          break;
        case 'clear-players':
          if (t && confirm('명단을 초기화할까요?')) { t.players = []; t.data = null; t.warnings = []; saveState(); render(); }
          break;
        case 'download-excel-template': downloadExcelTemplate(); break;
        case 'export-backup': state.modal = null; render(); exportBackupJSON(); break;
        case 'open-backup-import': state.modal = null; render(); document.getElementById('json-backup-input')?.click(); break;
        case 'export-results-excel': exportResultsExcel(); break;
        case 'set-type':
          if (t) { t.type = target.dataset.val; if (t.type === 'group' && t.config.groupCount < 2) t.config.groupCount = 2; saveState(); render(); }
          break;
        case 'set-team-mode':
          if (t) { t.config.teamMode = target.dataset.val; saveState(); render(); }
          break;
        case 'toggle-mixed-overflow':
          if (t) { t.config.allowMixedOverflow = !t.config.allowMixedOverflow; saveState(); render(); }
          break;
        case 'generate-draw': generateDrawForActive(); break;
        case 'add-event-round': addEventRound(); break;
        case 'wo-tournament': {
          const g = t?.data?.groups.find((x) => x.id === target.dataset.gid);
          const m = g?.rounds[Number(target.dataset.ridx)]?.matches.find((x) => x.id === target.dataset.mid);
          if (m) {
            const wo = (E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad']).walkoverScore;
            if (target.dataset.winner === 'A') { m.scoreA = wo; m.scoreB = 0; m.winnerSide = 'A'; }
            else { m.scoreA = 0; m.scoreB = wo; m.winnerSide = 'B'; }
            m.status = 'walkover'; m.note = '기권승(W/O)';
            E.propagateBracketWinners(g.rounds);
            saveState(); render(); toast('기권승(W/O) 반영됨');
          }
          break;
        }
        case 'auto-lineup': {
          const g = t?.data?.groups.find((x) => x.id === target.dataset.gid);
          if (g) { g.lineup = E.buildAutoLineupForGroup(g.members, t.data.gamesPerTie, t.config.teamMode); syncGroupLineupToTies(t, g.id); saveState(); render(); toast('추천 오더 반영됨'); }
          break;
        }
        case 'confirm-lineup': {
          const g = t?.data?.groups.find((x) => x.id === target.dataset.gid);
          if (g) { g.lineupSubmitted = true; syncGroupLineupToTies(t, g.id); saveState(); render(); toast(`${g.name} 오더 확정`); }
          break;
        }
        case 'apply-skill-preset': {
          const pr = E.SKILL_PRESETS[target.dataset.preset];
          if (t && pr) { t.skillPresetId = pr.id; t.skillLevels = JSON.parse(JSON.stringify(pr.levels)); saveState(); render(); }
          break;
        }
        case 'save-custom-skills': {
          const lines = (document.getElementById('custom-skill-text')?.value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const parsed = lines.map((line, i, arr) => {
            const p = line.split(',').map((s) => s.trim());
            return { code: p[0] || `L${i + 1}`, label: p[1] || p[0] || `L${i + 1}`, weight: Number(p[2]) || (arr.length - i) };
          });
          if (t && parsed.length) { t.skillPresetId = 'custom'; t.skillLevels = parsed; state.modal = null; saveState(); render(); toast('등급 체계 저장됨'); }
          break;
        }
        case 'exec-substitute': {
          const oldId = document.getElementById('inc-player')?.value;
          const nm = (document.getElementById('inc-sub-name')?.value || '').trim();
          if (!t || !oldId || !nm) return toast('대체 선수 이름을 입력하세요.');
          const oldP = t.players.find((p) => p.id === oldId); if (oldP) oldP.status = 'withdrawn';
          const newP = { id: E.uid('p'), name: nm, gender: document.getElementById('inc-sub-gender').value, skill: document.getElementById('inc-sub-skill').value, status: 'active' };
          t.players.push(newP);
          const cnt = E.substitutePlayerInTournament(t, oldId, newP);
          state.modal = null; saveState(); render(); toast(`${nm} 대체 완료 (${cnt}경기 반영)`);
          break;
        }
        case 'exec-walkover': {
          const pid = document.getElementById('inc-player')?.value;
          if (!t || !pid) return;
          const p = t.players.find((x) => x.id === pid); if (p) p.status = 'withdrawn';
          const wo = (E.MATCH_FORMATS[t.config.matchFormat] || E.MATCH_FORMATS['6game-noad']).walkoverScore;
          const cnt = E.walkoverPlayerInTournament(t, pid, wo);
          state.modal = null; saveState(); render(); toast(`기권 처리 완료 (${cnt}경기 반영)`);
          break;
        }
      }
    };

    document.getElementById('app').onchange = function (e) {
      const el = e.target;
      if (el.id === 'json-backup-input') { importBackupJSON(el.files[0]); return; }
      if (!t) return;
      if (el.id === 'excel-file-input') { handleFileImport(el.files[0]); return; }
      if (el.id === 'tournament-name-input') { t.name = el.value.trim() || t.name; saveState(); render(); return; }
      if (el.id === 'cfg-match-format') { t.config.matchFormat = el.value; saveState(); render(); return; }
      if (el.id === 'cfg-group-count') { t.config.groupCount = Number(el.value); saveState(); render(); return; }
      if (el.id === 'cfg-group-mode') { t.config.groupMode = el.value; saveState(); return; }
      if (el.id === 'cfg-pairing-strategy') { t.config.pairingStrategy = el.value; saveState(); return; }
      if (el.id === 'cfg-games-per-player') { t.config.gamesPerPlayer = Number(el.value); saveState(); return; }
      if (el.id === 'cfg-games-per-tie') { t.config.gamesPerTie = Number(el.value); saveState(); return; }

      const act = el.dataset.action;
      if (act === 'change-player-skill') { const p = t.players.find((x) => x.id === el.dataset.pid); if (p) { p.skill = el.value; saveState(); render(); } }
      else if (act === 'score-tournament') { const m = t.data.groups.find((x) => x.id === el.dataset.gid)?.rounds[Number(el.dataset.ridx)]?.matches.find((x) => x.id === el.dataset.mid); if (m) updateScore(m, el.dataset.side, el.value, t); }
      else if (act === 'score-individual') { const m = t.data.groups.find((x) => x.id === el.dataset.gid)?.matches.find((x) => x.id === el.dataset.mid); if (m) updateScore(m, el.dataset.side, el.value, t); }
      else if (act === 'score-group') { const m = t.data.ties.find((x) => x.id === el.dataset.tid)?.matches.find((x) => x.id === el.dataset.mid); if (m) updateScore(m, el.dataset.side, el.value, t); }
      else if (act === 'score-event') { const m = t.data.matches.find((x) => x.id === el.dataset.mid); if (m) updateScore(m, el.dataset.side, el.value, t); }
      else if (act === 'change-captain') { const g = t.data.groups.find((x) => x.id === el.dataset.gid); if (g) { g.captainId = el.value; saveState(); } }
      else if (act === 'edit-lineup') { const g = t.data.groups.find((x) => x.id === el.dataset.gid); const sl = g?.lineup[Number(el.dataset.sidx)]; if (sl) { sl[el.dataset.slot] = el.value; g.lineupSubmitted = false; syncGroupLineupToTies(t, g.id); saveState(); render(); } }
    };

    const addForm = document.getElementById('add-player-form');
    if (addForm && t) {
      addForm.onsubmit = function (e) {
        e.preventDefault();
        const nm = document.getElementById('p-name').value.trim();
        if (!nm) return;
        t.players.push({ id: E.uid('p'), name: nm, gender: document.getElementById('p-gender').value, skill: document.getElementById('p-skill').value, status: 'active' });
        saveState(); render();
        document.getElementById('p-name')?.focus();
      };
    }

    const ntForm = document.getElementById('new-tournament-form');
    if (ntForm) {
      ntForm.onsubmit = function (e) {
        e.preventDefault();
        const name = document.getElementById('nt-name').value.trim() || '새 테니스 대회';
        const type = document.getElementById('nt-type').value;
        const newT = createTournamentObject({
          name, type,
          players: document.getElementById('nt-sample').checked ? makeSampleRoster(8) : [],
          config: { teamMode: document.getElementById('nt-team-mode').value, groupCount: type === 'group' ? 2 : 1 },
        });
        state.tournaments.push(newT);
        state.activeTournamentId = newT.id;
        state.activeSection = 'roster';
        state.modal = null;
        saveState(); render();
        toast(`"${name}" 생성됨`);
      };
    }

    const meForm = document.getElementById('manual-event-form');
    if (meForm && t) {
      meForm.onsubmit = function (e) {
        e.preventDefault();
        const ids = ['me-a1', 'me-a2', 'me-b1', 'me-b2'].map((id) => document.getElementById(id).value);
        const byId = {}; t.players.forEach((p) => (byId[p.id] = p));
        if (!t.data) t.data = { matches: [], resting: [] };
        t.data.matches.push({
          id: E.uid('em'), order: t.data.matches.length + 1,
          formatLabel: document.getElementById('me-label').value.trim() || '이벤트',
          teamA: { players: [ids[0], ids[1]], names: [byId[ids[0]]?.name || '', byId[ids[1]]?.name || ''], label: `${byId[ids[0]]?.name || ''} / ${byId[ids[1]]?.name || ''}` },
          teamB: { players: [ids[2], ids[3]], names: [byId[ids[2]]?.name || '', byId[ids[3]]?.name || ''], label: `${byId[ids[2]]?.name || ''} / ${byId[ids[3]]?.name || ''}` },
          scoreA: null, scoreB: null, status: 'pending', note: '',
        });
        state.modal = null; saveState(); render(); toast('즉석 경기 추가됨');
      };
    }

    const dz = document.getElementById('excel-dropzone');
    const fi = document.getElementById('excel-file-input');
    if (dz && fi) {
      dz.onclick = () => fi.click();
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
      dz.ondragleave = () => dz.classList.remove('dragover');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFileImport(e.dataTransfer.files[0]); };
    }
  }

  loadState();
  render();
})();
