/* 소유네 반도체 게임 — 공통 공장 장부 (모든 게임이 함께 쓴다)
 *
 * 한 판이 끝날 때마다 게임이 FAB.report(게임, 기록)를 부르면:
 *   웨이퍼(공통 재화)를 정산하고, 오늘의 공정(일일 미션)·업적·최고 기록을 갱신하고,
 *   화면 위에 결과 쪽지를 잠깐 띄운다.
 * 페이지를 열 때마다 출근 도장(연속 접속 보상)을 찍는다.
 * 상점에서 산 꾸미기는 FAB.equipped(게임, 자리)로 각 게임이 읽어 쓴다.
 * 저장은 이 기기 브라우저(localStorage) 하나에만 한다. 같은 주소(사이트) 아래 모든 게임이 한 장부를 쓴다.
 */
(function () {
  "use strict";
  const KEY = "fab.v1";
  const pad = n => String(n).padStart(2, "0");
  const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayOf(new Date());
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayOf(d); };

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  const S = Object.assign({ wafers: 0, earned: 0, owned: [], equip: {}, ach: {}, best: {}, tot: {}, att: { last: null, streak: 0, days: 0 }, day: null, mis: [] }, load());
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  // 예전 장부(산 꾸미기가 영구였던 때): 코팅 20판으로 바꾸어 준다
  if (!S.ver) { S.uses = S.uses || {}; for (const id of S.owned || []) S.uses[id] = (S.uses[id] || 0) + 20; S.owned = []; S.ver = 2; }
  S.uses = S.uses || {};
  // 야구왕 홈런 득점 버그로 부풀려진 명예의 전당 기록을 한 번만 지운다
  if (!S.bbReset) { if (S.best) delete S.best.baseball; S.bbReset = 1; }
  // 버그 잡기가 문을 닫았다: 산 꾸미기는 산 값 그대로 웨이퍼로 돌려준다
  const BUG_PRICE = { bug_bolt: [300, 5000], bug_fire: [500, 8000], bug_hammer: [300, 4500], bug_iron: [400, 6000], bug_vac: [500, 7500], bug_night: [450, 7000] };
  if (!S.bugsGone) {
    let back = 0;
    for (const id in BUG_PRICE) {
      if ((S.owned || []).includes(id)) back += BUG_PRICE[id][1];
      else if ((S.uses || {})[id] > 0) back += BUG_PRICE[id][0];
      S.owned = (S.owned || []).filter(x => x !== id); delete S.uses[id];
    }
    for (const k in S.equip || {}) if (k.startsWith("bugs.")) delete S.equip[k];
    if (S.best) delete S.best.bugs;
    if (back) { S.wafers += back; S.notice = { earned: back, lines: [["환불", "버그 잡기 꾸미기", back]], title: `버그 잡기 종료 · 꾸미기 환불 +${back}` }; }
    S.bugsGone = 1;
  }

  const GAMES = { chip: "칩 쌓기", baseball: "야구왕", zero: "ZERO RUN", nn: "99", pin: "웨이퍼 핀볼", bond: "와이어 본딩", rail: "팹 물류" };

  // ---------- 웨이퍼 정산: 한 판 기록 → 웨이퍼 ----------
  const EARN = {
    // 게임마다 '보통 한 판'이 2~3장, 아주 잘한 판이 6~8장이 되도록 난이도에 맞춰 맞춘다 (한 판 최대 10장)
    chip: s => Math.floor((s.layers || 0) / 4),                                        // 12단 3장 · 20단 5장
    baseball: s => Math.floor((s.runs || 0) / 2) + Math.floor((s.hits || 0) / 4) + (s.hr || 0),   // 4점·안타 4·홈런 1 = 4장
    zero: s => 1 + Math.floor((s.bytes || 0) / 25),                                    // 50B 3장 · 150B 7장 (어려운 만큼 후하게)
    nn: s => (s.win ? 3 : 1),
    pin: s => Math.floor((s.score || 0) / 12000),                                     // 3만 점 2장 · 6만 점 5장
    bond: s => Math.floor((s.chips || 0) / 2) + Math.floor((s.bonds || 0) / 40),       // 칩 6개(본딩 70) 4장
    rail: s => Math.floor((s.score || 0) / 10),                                        // 30점 3장 · 60점 6장
  };

  // ---------- 오늘의 공정: 날마다 서로 다른 게임에서 세 가지 ----------
  // mode sum: 오늘 하루 동안 더한 값, max: 오늘 한 판에서 낸 가장 큰 값
  const MISSIONS = [
    { id: "chip12", g: "chip", k: "layers", t: 12, mode: "max", label: "칩 12단 쌓기", r: 30 },
    { id: "chipPerf", g: "chip", k: "perfect", t: 15, mode: "sum", label: "칩 쌓기에서 딱! 15번", r: 30 },
    { id: "hit5", g: "baseball", k: "hits", t: 5, mode: "sum", label: "야구왕 안타 5개", r: 30 },
    { id: "hr1", g: "baseball", k: "hr", t: 1, mode: "sum", label: "야구왕 홈런 1개", r: 35 },
    { id: "run6", g: "baseball", k: "runs", t: 6, mode: "max", label: "야구왕 한 판 6점", r: 40 },
    { id: "zr150", g: "zero", k: "bytes", t: 100, mode: "max", label: "ZERO RUN 100B 달리기", r: 40 },
    { id: "zr3", g: "zero", k: "plays", t: 3, mode: "sum", label: "ZERO RUN 3판", r: 25 },
    { id: "nn1", g: "nn", k: "wins", t: 1, mode: "sum", label: "99에서 1번 이기기", r: 30 },
    { id: "nn3", g: "nn", k: "plays", t: 3, mode: "sum", label: "99 3판", r: 25 },
    { id: "pin20k", g: "pin", k: "score", t: 20000, mode: "max", label: "핀볼 한 판 20,000점", r: 35 },
    { id: "pinBoss", g: "pin", k: "bossKills", t: 1, mode: "sum", label: "핀볼 불량 다이 1개 부수기", r: 35 },
    { id: "bond3", g: "bond", k: "chips", t: 3, mode: "max", label: "와이어 본딩 한 판 칩 3개 점등", r: 30 },
    { id: "bondPf", g: "bond", k: "perfect", t: 30, mode: "sum", label: "와이어 본딩 딱! 30번", r: 30 },
    { id: "rail20", g: "rail", k: "score", t: 20, mode: "max", label: "팹 물류 한 판 20점", r: 35 },
    { id: "rail50", g: "rail", k: "delivered", t: 50, mode: "sum", label: "팹 물류 웨이퍼 통 50개 배송", r: 30 },
  ];
  const ALL_DONE_BONUS = 60;
  function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
  function rollDay() {
    const d = today();
    if (S.day === d && S.mis.length && S.mis.every(m => missionDef(m.id))) return;
    const rnd = seeded("fab" + d), pool = MISSIONS.slice(), pick = [], used = new Set();
    while (pick.length < 3 && pool.length) {
      const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      if (used.has(m.g)) continue;
      used.add(m.g); pick.push({ id: m.id, v: 0, done: false });
    }
    S.day = d; S.mis = pick; S.bonus = false; save();
  }
  const missionDef = id => MISSIONS.find(m => m.id === id);

  // ---------- 업적 ----------
  // 업적: g는 어느 게임 칸에 보일지(all = 공장 전체). 한 판 기록은 run, 누적은 cum으로 만든다
  const T = (g, k) => ((S.tot[g] || {})[k] || 0);
  const plays = () => Object.keys(GAMES).reduce((a, g) => a + T(g, "plays"), 0);
  const run = (id, g, k, t, label, desc, r) => ({ id, g, label, desc, r, ok: (gg, s) => gg === g && (+s[k] || 0) >= t });
  const cum = (id, g, k, t, label, desc, r) => ({ id, g, label, desc, r, ok: () => T(g, k) >= t });
  const ACH = [
    // ----- 공장 전체 -----
    { id: "first", g: "all", label: "첫 출근", desc: "아무 게임이나 한 판", r: 10, ok: () => true },
    { id: "all5", g: "all", label: "전 라인 순회", desc: "모든 게임을 한 판씩", r: 40, ok: () => Object.keys(GAMES).every(g => T(g, "plays")) },
    { id: "p100", g: "all", label: "가동률 100판", desc: "모든 게임 합쳐 100판", r: 60, ok: () => plays() >= 100 },
    { id: "p500", g: "all", label: "24시간 가동", desc: "모든 게임 합쳐 500판", r: 200, ok: () => plays() >= 500 },
    { id: "p1000", g: "all", label: "무중단 라인", desc: "모든 게임 합쳐 1,000판", r: 400, ok: () => plays() >= 1000 },
    { id: "att7", g: "all", label: "개근상", desc: "7일 연속 출근", r: 100, ok: () => S.att.streak >= 7 },
    { id: "att14", g: "all", label: "2주 개근", desc: "14일 연속 출근", r: 200, ok: () => S.att.streak >= 14 },
    { id: "att30", g: "all", label: "한 달 개근", desc: "30일 연속 출근", r: 500, ok: () => S.att.streak >= 30 },
    { id: "day10", g: "all", label: "출근 10일", desc: "출근한 날 모두 10일", r: 60, ok: () => S.att.days >= 10 },
    { id: "day30", g: "all", label: "출근 30일", desc: "출근한 날 모두 30일", r: 150, ok: () => S.att.days >= 30 },
    { id: "day100", g: "all", label: "출근 100일", desc: "출근한 날 모두 100일", r: 500, ok: () => S.att.days >= 100 },
    { id: "w1000", g: "all", label: "웨이퍼 부자", desc: "웨이퍼 누적 1,000장", r: 50, ok: () => S.earned >= 1000 },
    { id: "w3000", g: "all", label: "웨이퍼 창고", desc: "웨이퍼 누적 3,000장", r: 100, ok: () => S.earned >= 3000 },
    { id: "w10000", g: "all", label: "웨이퍼 재벌", desc: "웨이퍼 누적 10,000장", r: 300, ok: () => S.earned >= 10000 },
    { id: "w30000", g: "all", label: "웨이퍼 제국", desc: "웨이퍼 누적 30,000장", r: 800, ok: () => S.earned >= 30000 },
    { id: "rk1", g: "all", label: "정규직 전환", desc: "사원 승진", r: 20, ok: () => rankOf(S.earned) >= 1 },
    { id: "rk2", g: "all", label: "첫 부하 직원", desc: "대리 승진", r: 50, ok: () => rankOf(S.earned) >= 2 },
    { id: "rk3", g: "all", label: "라인 책임", desc: "과장 승진", r: 100, ok: () => rankOf(S.earned) >= 3 },
    { id: "rk4", g: "all", label: "공정 오너", desc: "책임 승진", r: 200, ok: () => rankOf(S.earned) >= 4 },
    { id: "rk5", g: "all", label: "기술 장인", desc: "수석 승진", r: 400, ok: () => rankOf(S.earned) >= 5 },
    { id: "rk6", g: "all", label: "팹의 주인", desc: "팹장 승진", r: 1000, ok: () => rankOf(S.earned) >= 6 },
    { id: "mis1", g: "all", label: "첫 공정 완료", desc: "오늘의 공정 하나 끝내기", r: 10, ok: () => (S.misDone || 0) >= 1 },
    { id: "mis10", g: "all", label: "공정 10건", desc: "오늘의 공정 누적 10개", r: 50, ok: () => (S.misDone || 0) >= 10 },
    { id: "mis50", g: "all", label: "공정 50건", desc: "오늘의 공정 누적 50개", r: 150, ok: () => (S.misDone || 0) >= 50 },
    { id: "mis150", g: "all", label: "공정의 달인", desc: "오늘의 공정 누적 150개", r: 400, ok: () => (S.misDone || 0) >= 150 },
    { id: "full1", g: "all", label: "완벽한 하루", desc: "오늘의 공정 셋을 하루에 다", r: 30, ok: () => (S.fullDays || 0) >= 1 },
    { id: "full7", g: "all", label: "완벽한 일주일", desc: "공정 셋을 다 끝낸 날 7일", r: 150, ok: () => (S.fullDays || 0) >= 7 },
    { id: "full30", g: "all", label: "무결점 한 달", desc: "공정 셋을 다 끝낸 날 30일", r: 500, ok: () => (S.fullDays || 0) >= 30 },
    { id: "buy1", g: "all", label: "첫 장비 도입", desc: "상점에서 처음 사기", r: 20, ok: () => (S.buys || 0) >= 1 },
    { id: "buy10", g: "all", label: "단골 고객", desc: "상점에서 10번 사기", r: 100, ok: () => (S.buys || 0) >= 10 },
    { id: "own1", g: "all", label: "첫 소장품", desc: "소장판 하나 갖기", r: 150, ok: () => (S.owned || []).length >= 1 },
    { id: "own5", g: "all", label: "수집가", desc: "소장판 다섯 개 갖기", r: 500, ok: () => (S.owned || []).length >= 5 },
    // ----- 칩 쌓기 -----
    run("chip4", "chip", "layers", 4, "HBM 첫 세대", "칩 4단 쌓기", 10),
    run("chip8", "chip", "layers", 8, "HBM3 양산", "칩 8단 쌓기", 30),
    run("chip12", "chip", "layers", 12, "HBM3E 양산", "칩 12단 쌓기", 60),
    run("chip16", "chip", "layers", 16, "HBM4 양산", "칩 16단 쌓기", 120),
    run("chip20", "chip", "layers", 20, "세상에 없는 칩", "칩 20단 쌓기", 250),
    run("chip24", "chip", "layers", 24, "차세대 로드맵", "칩 24단 쌓기", 400),
    run("chip28", "chip", "layers", 28, "물리 한계 도전", "칩 28단 쌓기", 600),
    run("chip32", "chip", "layers", 32, "전설의 32단", "칩 32단 쌓기", 1000),
    run("perf3", "chip", "maxCombo", 3, "정렬 감 잡기", "딱! 3연속", 10),
    run("perf5", "chip", "maxCombo", 5, "정렬 숙련", "딱! 5연속", 30),
    run("perf10", "chip", "maxCombo", 10, "TSV 정렬 장인", "딱! 10연속", 100),
    run("perf15", "chip", "maxCombo", 15, "나노 정렬", "딱! 15연속", 250),
    run("perf20", "chip", "maxCombo", 20, "빛이 꿰뚫는 탑", "딱! 20연속", 500),
    run("pr10", "chip", "perfect", 10, "딱 열 번", "한 판에 딱! 10번", 40),
    run("pr20", "chip", "perfect", 20, "딱 스무 번", "한 판에 딱! 20번", 150),
    cum("chipL100", "chip", "layers", 100, "칩 100장 양산", "누적 100단", 30),
    cum("chipL500", "chip", "layers", 500, "칩 500장 양산", "누적 500단", 100),
    cum("chipL2000", "chip", "layers", 2000, "칩 2,000장 양산", "누적 2,000단", 300),
    cum("chipP100", "chip", "perfect", 100, "딱! 100번", "누적 딱! 100번", 60),
    cum("chipP1000", "chip", "perfect", 1000, "딱! 1,000번", "누적 딱! 1,000번", 300),
    cum("chipG10", "chip", "plays", 10, "패키징 라인 견습", "칩 쌓기 10판", 20),
    cum("chipG100", "chip", "plays", 100, "패키징 라인 반장", "칩 쌓기 100판", 120),
    // ----- 야구왕 -----
    run("bbR1", "baseball", "runs", 1, "첫 득점", "한 판 1점", 10),
    run("bbR3", "baseball", "runs", 3, "선취점", "한 판 3점", 20),
    run("bbR5", "baseball", "runs", 5, "투수 교체", "한 판 5점", 40),
    run("runs10", "baseball", "runs", 10, "빅이닝", "한 판 10점", 100),
    run("bbR15", "baseball", "runs", 15, "마무리 붕괴", "한 판 15점", 150),
    run("ace", "baseball", "runs", 20, "괴물 사냥", "한 판 20점 (괴물 투수 등판)", 200),
    run("bbR30", "baseball", "runs", 30, "괴물도 무너졌다", "한 판 30점", 500),
    run("bbH3", "baseball", "hits", 3, "멀티 히트", "한 판 안타 3개", 10),
    run("bbH6", "baseball", "hits", 6, "타선 폭발", "한 판 안타 6개", 40),
    run("bbH10", "baseball", "hits", 10, "두 자릿수 안타", "한 판 안타 10개", 120),
    run("hr", "baseball", "hr", 1, "첫 홈런", "한 판 홈런 1개", 20),
    run("bbHR2", "baseball", "hr", 2, "멀티 홈런", "한 판 홈런 2개", 60),
    run("bbHR4", "baseball", "hr", 4, "홈런 더비", "한 판 홈런 4개", 200),
    { id: "b2b", g: "baseball", label: "백투백", desc: "두 타자 연속 홈런", r: 60, ok: (g, s) => g === "baseball" && s.b2b },
    run("steal", "baseball", "steals", 1, "대도", "도루 성공", 20),
    run("bbS3", "baseball", "steals", 3, "발야구", "한 판 도루 3개", 80),
    cum("bbS20", "baseball", "steals", 20, "도루왕", "누적 도루 20개", 150),
    cum("bbHRc10", "baseball", "hr", 10, "홈런 10개", "누적 홈런 10개", 60),
    cum("bbHRc50", "baseball", "hr", 50, "홈런왕", "누적 홈런 50개", 250),
    cum("bbRc100", "baseball", "runs", 100, "100득점", "누적 100점", 80),
    cum("bbRc500", "baseball", "runs", 500, "500득점", "누적 500점", 300),
    cum("bbG10", "baseball", "plays", 10, "클린룸 리그 데뷔", "야구왕 10판", 20),
    cum("bbG100", "baseball", "plays", 100, "클린룸 리그 레전드", "야구왕 100판", 150),
    // ----- ZERO RUN -----
    run("zr25", "zero", "bytes", 25, "첫 바이트", "한 판 25B", 10),
    run("zr50", "zero", "bytes", 50, "50B 통과", "한 판 50B", 20),
    run("zr100", "zero", "bytes", 100, "100B 통과", "한 판 100B", 40),
    run("zr150", "zero", "bytes", 150, "캐시 적중", "한 판 150B", 80),
    run("zr200", "zero", "bytes", 200, "오버클럭 돌파", "한 판 200B", 120),
    run("zr250", "zero", "bytes", 250, "커널 패닉 생존", "한 판 250B", 150),
    run("zr300", "zero", "bytes", 300, "패닉 속 질주", "한 판 300B", 250),
    run("zr400", "zero", "bytes", 400, "메모리 누수 정복", "한 판 400B", 400),
    run("zr512", "zero", "bytes", 512, "반 킬로바이트", "한 판 512B", 700),
    cum("zrB1k", "zero", "bytes", 1024, "누적 1KB", "누적 1,024B", 40),
    cum("zrB5k", "zero", "bytes", 5120, "누적 5KB", "누적 5,120B", 150),
    cum("zrB20k", "zero", "bytes", 20480, "누적 20KB", "누적 20,480B", 400),
    cum("zrG10", "zero", "plays", 10, "회로 탐험가", "ZERO RUN 10판", 20),
    cum("zrG50", "zero", "plays", 50, "회로 개척자", "ZERO RUN 50판", 80),
    cum("zrG200", "zero", "plays", 200, "끝없는 0", "ZERO RUN 200판", 250),
    // ----- 99 -----
    run("nn1", "nn", "win", 1, "레지스터 장악", "99 첫 승", 20),
    run("nn2", "nn", "streak", 2, "손에 불이 붙었다", "99 2연승", 40),
    run("nn3", "nn", "streak", 3, "오버클럭", "99 3연승", 80),
    run("nn5", "nn", "streak", 5, "CPU 과열", "99 5연승", 200),
    run("nn7", "nn", "streak", 7, "멈출 수 없다", "99 7연승", 400),
    run("nn10", "nn", "streak", 10, "CPU 정복자", "99 10연승", 800),
    cum("nnW10", "nn", "win", 10, "10승", "99 누적 10승", 60),
    cum("nnW50", "nn", "win", 50, "50승", "99 누적 50승", 200),
    cum("nnW100", "nn", "win", 100, "100승", "99 누적 100승", 400),
    cum("nnG10", "nn", "plays", 10, "연산 유닛 견습", "99 10판", 20),
    cum("nnG100", "nn", "plays", 100, "연산 유닛 반장", "99 100판", 150),
    // ----- 웨이퍼 핀볼 -----
    run("pin5k", "pin", "score", 5000, "첫 전원 인가", "한 판 5,000점", 10),
    run("pin20k", "pin", "score", 20000, "회로 활성화", "한 판 20,000점", 30),
    run("pin50k", "pin", "score", 50000, "고전압 구간", "한 판 50,000점", 80),
    run("pin100k", "pin", "score", 100000, "10만 볼트", "한 판 100,000점", 200),
    run("pin200k", "pin", "score", 200000, "기판이 녹는다", "한 판 200,000점", 500),
    run("pinClk2", "pin", "clock", 2, "클럭 업", "WAFER 다섯 글자 켜기", 20),
    run("pinClk3", "pin", "clock", 3, "오버클럭", "한 판 배율 ×3", 60),
    run("pinClk5", "pin", "clock", 5, "최대 클럭", "한 판 배율 ×5", 250),
    run("pinBoss1", "pin", "bossKills", 1, "불량 제거", "불량 다이 부수기", 40),
    run("pinBoss3", "pin", "bossKills", 3, "불량률 제로", "한 판 불량 다이 3개", 200),
    run("pinJack3", "pin", "jackpots", 3, "비아 홀 단골", "한 판 비아 홀 잭팟 3번", 60),
    cum("pinBossC10", "pin", "bossKills", 10, "결함 사냥꾼", "누적 불량 다이 10개", 150),
    cum("pinS1m", "pin", "score", 1000000, "누적 100만 점", "핀볼 누적 1,000,000점", 120),
    cum("pinS5m", "pin", "score", 5000000, "누적 500만 점", "핀볼 누적 5,000,000점", 400),
    cum("pinG10", "pin", "plays", 10, "테스트 보드 견습", "핀볼 10판", 20),
    cum("pinG100", "pin", "plays", 100, "테스트 보드 반장", "핀볼 100판", 150),
    // ----- 와이어 본딩 -----
    run("bondC1", "bond", "chips", 1, "첫 점등", "칩 1개 점등", 10),
    run("bondC3", "bond", "chips", 3, "오디오 칩 완성", "한 판 칩 3개", 30),
    run("bondC5", "bond", "chips", 5, "이미지 센서 완성", "한 판 칩 5개", 60),
    run("bondC8", "bond", "chips", 8, "AP 완성", "한 판 칩 8개", 150),
    run("bondC10", "bond", "chips", 10, "HBM 컨트롤러 완성", "한 판 칩 10개", 300),
    run("bondC13", "bond", "chips", 13, "꿈의 칩", "한 판 칩 13개", 700),
    run("bondK5", "bond", "maxCombo", 5, "손이 기억한다", "딱! 5연속", 20),
    run("bondK10", "bond", "maxCombo", 10, "금선 장인", "딱! 10연속", 60),
    run("bondK20", "bond", "maxCombo", 20, "현미경 속 명인", "딱! 20연속", 200),
    run("bondK40", "bond", "maxCombo", 40, "신의 손", "딱! 40연속", 500),
    run("bondB50", "bond", "bonds", 50, "본딩 50가닥", "한 판 본딩 50번", 60),
    cum("bondBc500", "bond", "bonds", 500, "금선 500가닥", "누적 본딩 500번", 80),
    cum("bondBc3000", "bond", "bonds", 3000, "금선 3,000가닥", "누적 본딩 3,000번", 300),
    cum("bondCc50", "bond", "chips", 50, "칩 50개 점등", "누적 칩 50개", 150),
    cum("bondG10", "bond", "plays", 10, "본딩 라인 견습", "와이어 본딩 10판", 20),
    cum("bondG100", "bond", "plays", 100, "본딩 라인 반장", "와이어 본딩 100판", 150),
    // ----- 팹 물류 -----
    run("rail5", "rail", "score", 5, "첫 배송", "한 판 5점", 10),
    run("rail20", "rail", "score", 20, "세정 장비 반입", "한 판 20점", 30),
    run("rail50", "rail", "score", 50, "계측 장비 반입", "한 판 50점", 80),
    run("rail80", "rail", "score", 80, "무정지 라인", "한 판 80점", 200),
    run("rail120", "rail", "score", 120, "물류의 신", "한 판 120점", 500),
    run("railK5", "rail", "maxCombo", 5, "정시 배송", "연속 5개 배송", 20),
    run("railK10", "rail", "maxCombo", 10, "무오배송", "연속 10개 배송", 60),
    run("railK25", "rail", "maxCombo", 25, "완벽한 관제", "연속 25개 배송", 200),
    run("railK50", "rail", "maxCombo", 50, "AMHS 그 자체", "연속 50개 배송", 500),
    run("railClean", "rail", "clean", 1, "경보 없는 하루", "한 판 20점까지 오배송 0", 100),
    cum("railD100", "rail", "delivered", 100, "통 100개", "누적 배송 100개", 40),
    cum("railD1000", "rail", "delivered", 1000, "통 1,000개", "누적 배송 1,000개", 200),
    cum("railD5000", "rail", "delivered", 5000, "통 5,000개", "누적 배송 5,000개", 500),
    cum("railG10", "rail", "plays", 10, "관제실 견습", "팹 물류 10판", 20),
    cum("railG100", "rail", "plays", 100, "관제실 반장", "팹 물류 100판", 150),
  ];

  // ---------- 직급: 누적 웨이퍼로 승진한다 ----------
  const RANKS = [
    { name: "인턴", at: 0 }, { name: "사원", at: 300 }, { name: "대리", at: 1000 }, { name: "과장", at: 2500 },
    { name: "책임", at: 5000 }, { name: "수석", at: 10000 }, { name: "팹장", at: 20000 },
  ];
  const rankOf = e => { let i = 0; while (i + 1 < RANKS.length && e >= RANKS[i + 1].at) i++; return i; };

  // ---------- 상점: 겉모습만 바꾸는 꾸미기 ----------
  // 코팅(소모형): uses판 동안만 쓰고 닳는다 · 소장판(영구형): 비싸고 높은 직급에서 열린다
  // c: [코팅 가격, 판 수, 필요 직급], p: [소장 가격, 필요 직급]
  const SLOTS = { skin: "재질", ball: "공", fx: "효과", glow: "빛", hat: "모자", trail: "꼬리", pat: "무늬", land: "착지", head: "머리", hand: "손", bat: "배트", back: "뒷면", flip: "플리퍼", table: "판", wire: "와이어", lens: "렌즈", foup: "통", rail: "레일" };
  const SHOP = [
    { id: "chip_neon", g: "chip", slot: "skin", name: "네온 핑크 칩", c: [250, 20, 0], p: [4000, 3], col: "#ff6fb5" },
    { id: "chip_gold", g: "chip", slot: "skin", name: "금 도금 칩", c: [400, 20, 2], p: [6000, 4], col: "#ffcf3a" },
    { id: "chip_rainbow", g: "chip", slot: "skin", name: "무지개 웨이퍼 칩", c: [600, 20, 3], p: [9000, 5], col: "linear-gradient(90deg,#ff5a6a,#ffcf3a,#5dffc3,#3bd1ff,#b38cff)" },
    { id: "bb_sky", g: "baseball", slot: "ball", name: "하늘 전자 공", c: [250, 15, 0], p: [4000, 3], col: "#3bd1ff" },
    { id: "bb_pink", g: "baseball", slot: "ball", name: "핑크 전자 공", c: [250, 15, 1], p: [4000, 3], col: "#ff6fb5" },
    { id: "bb_gold", g: "baseball", slot: "ball", name: "금빛 전자 공", c: [400, 15, 2], p: [6000, 4], col: "#ffcf3a" },
    { id: "zr_sky", g: "zero", slot: "glow", name: "하늘빛 0", c: [250, 20, 0], p: [4000, 3], col: "#3bd1ff" },
    { id: "zr_pink", g: "zero", slot: "glow", name: "핑크빛 0", c: [250, 20, 1], p: [4000, 3], col: "#ff6fb5" },
    { id: "zr_gold", g: "zero", slot: "glow", name: "금빛 0", c: [400, 20, 2], p: [6000, 4], col: "#ffcf3a" },
    // ZERO RUN · 모자 · 꼬리
    { id: "zr_hood", g: "zero", slot: "hat", name: "방진 후드", c: [300, 20, 0], p: [4500, 3], col: "#eef3f8" },
    { id: "zr_helmet", g: "zero", slot: "hat", name: "노란 안전모", c: [350, 20, 1], p: [5000, 3], col: "#ffd23a" },
    { id: "zr_cap", g: "zero", slot: "hat", name: "졸업 학사모", c: [500, 20, 3], p: [7000, 4], col: "#2b3142" },
    { id: "zr_crown", g: "zero", slot: "hat", name: "팹장의 왕관", c: [800, 10, 5], p: [15000, 6], col: "linear-gradient(135deg,#fff2a8,#ffcf3a 50%,#c8961e)" },
    { id: "zr_bits", g: "zero", slot: "trail", name: "비트 흩날림", c: [400, 20, 1], p: [6000, 4], col: "repeating-linear-gradient(90deg,#5dffc3 0 4px,transparent 4px 8px)" },
    { id: "zr_rainbow", g: "zero", slot: "trail", name: "무지개 궤적", c: [600, 20, 3], p: [9000, 5], col: "linear-gradient(90deg,#ff5a6a,#ffcf3a,#5dffc3,#3bd1ff,#b38cff)" },
    // 칩 쌓기 · 그라데이션 · 무늬 · 착지
    { id: "chip_dawn", g: "chip", slot: "skin", name: "새벽 그라데이션", c: [350, 20, 1], p: [5000, 3], col: "linear-gradient(135deg,#2c3f8f,#c0508f)" },
    { id: "chip_dusk", g: "chip", slot: "skin", name: "노을 그라데이션", c: [350, 20, 1], p: [5000, 3], col: "linear-gradient(135deg,#d9782a,#7b3fae)" },
    { id: "chip_aurora", g: "chip", slot: "skin", name: "오로라 그라데이션", c: [500, 20, 2], p: [7000, 4], col: "linear-gradient(135deg,#2fbf7a,#3bb7e0)" },
    { id: "chip_circuit", g: "chip", slot: "pat", name: "금빛 회로 무늬", c: [400, 20, 2], p: [6500, 4], col: "repeating-linear-gradient(90deg,#14241f 0 5px,#ffcf3a 5px 7px)" },
    { id: "chip_spark", g: "chip", slot: "land", name: "딱! 불꽃", c: [400, 20, 1], p: [6000, 4], col: "radial-gradient(circle,#fff 10%,#ffcf3a 35%,#ff5a6a 70%)" },
    { id: "chip_ring", g: "chip", slot: "land", name: "딱! 파동 링", c: [500, 20, 2], p: [7500, 4], col: "radial-gradient(circle,transparent 30%,#ff6fb5 32% 42%,transparent 44% 58%,#3bd1ff 60% 70%,transparent 72%)" },
    // 야구왕 · 타자 장신구 · 배트 · 홈런 꼬리
    { id: "bb_shades", g: "baseball", slot: "head", name: "검은 선글라스", c: [300, 15, 0], p: [4500, 3], col: "#11131a" },
    { id: "bb_band", g: "baseball", slot: "head", name: "빨간 땀받이 띠", c: [300, 15, 1], p: [4500, 3], col: "#ff4a5a" },
    { id: "bb_phones", g: "baseball", slot: "head", name: "응원 헤드폰", c: [450, 15, 2], p: [6500, 4], col: "linear-gradient(90deg,#2a2f3f,#ff6fb5)" },
    { id: "bb_wrist", g: "baseball", slot: "hand", name: "금 손목밴드", c: [350, 15, 1], p: [5000, 3], col: "#ffcf3a" },
    { id: "bb_glove", g: "baseball", slot: "hand", name: "반짝이 장갑", c: [500, 15, 3], p: [7500, 4], col: "radial-gradient(circle,#fff 15%,#e9e4ff 40%,#ff6fb5 80%)" },
    { id: "bb_wbat", g: "baseball", slot: "bat", name: "웨이퍼 배트", c: [500, 15, 2], p: [8000, 4], col: "conic-gradient(#7f8fb5,#c7b4e6,#9fe0e8,#c9e7a8,#e8c79f,#7f8fb5)" },
    { id: "bb_laser", g: "baseball", slot: "bat", name: "레이저 배트", c: [700, 15, 4], p: [11000, 5], col: "linear-gradient(90deg,#1d3b52,#7ff6ff,#e6ffff)" },
    { id: "bb_fire", g: "baseball", slot: "trail", name: "홈런 불꽃 꼬리", c: [600, 15, 3], p: [9000, 5], col: "linear-gradient(90deg,#ff4620,#ffd25a)" },
    // 웨이퍼 핀볼 · 공 · 플리퍼 · 판
    { id: "pin_gold", g: "pin", slot: "ball", name: "금빛 전자 공", c: [300, 15, 0], p: [4500, 3], col: "#ffcf3a" },
    { id: "pin_plasma", g: "pin", slot: "ball", name: "플라스마 공", c: [500, 15, 2], p: [7500, 4], col: "radial-gradient(circle,#fff 15%,#ff6fb5 45%,#7b3fff 85%)" },
    { id: "pin_fneon", g: "pin", slot: "flip", name: "네온 핑크 플리퍼", c: [350, 15, 1], p: [5000, 3], col: "#ff6fb5" },
    { id: "pin_fgold", g: "pin", slot: "flip", name: "금 도금 플리퍼", c: [500, 15, 2], p: [7000, 4], col: "linear-gradient(90deg,#c8961e,#fff2a8,#c8961e)" },
    { id: "pin_night", g: "pin", slot: "table", name: "야간 리소 조명 판", c: [600, 15, 3], p: [9000, 5], col: "linear-gradient(180deg,#ffd65a,#2a1f4a)" },
    // 와이어 본딩 · 와이어 · 효과 · 렌즈
    { id: "bond_silver", g: "bond", slot: "wire", name: "은 와이어", c: [300, 15, 0], p: [4500, 3], col: "linear-gradient(90deg,#8fa0b5,#eef3fa,#8fa0b5)" },
    { id: "bond_copper", g: "bond", slot: "wire", name: "구리 와이어", c: [350, 15, 1], p: [5000, 3], col: "linear-gradient(90deg,#8a4a24,#f0a070,#8a4a24)" },
    { id: "bond_rainbow", g: "bond", slot: "wire", name: "무지개 와이어", c: [600, 15, 3], p: [9000, 5], col: "linear-gradient(90deg,#ff5a6a,#ffcf3a,#5dffc3,#3bd1ff,#b38cff)" },
    { id: "bond_spark", g: "bond", slot: "fx", name: "딱! 불꽃놀이", c: [400, 15, 1], p: [6000, 4], col: "radial-gradient(circle,#fff 10%,#ffcf3a 35%,#ff5a6a 70%)" },
    { id: "bond_lens", g: "bond", slot: "lens", name: "금테 현미경", c: [500, 15, 2], p: [7500, 4], col: "radial-gradient(circle,transparent 45%,#ffcf3a 50% 62%,transparent 66%)" },
    // 팹 물류 · 통 · 레일 · 효과
    { id: "rail_fgold", g: "rail", slot: "foup", name: "금빛 FOUP", c: [350, 15, 1], p: [5000, 3], col: "#ffcf3a" },
    { id: "rail_fclear", g: "rail", slot: "foup", name: "투명 FOUP", c: [450, 15, 2], p: [6500, 4], col: "linear-gradient(135deg,rgba(200,240,255,.9),rgba(120,200,255,.4))" },
    { id: "rail_rgold", g: "rail", slot: "rail", name: "금 레일", c: [400, 15, 1], p: [6000, 4], col: "linear-gradient(90deg,#c8961e,#fff2a8,#c8961e)" },
    { id: "rail_rneon", g: "rail", slot: "rail", name: "네온 레일", c: [500, 15, 2], p: [7500, 4], col: "linear-gradient(90deg,#3bd1ff,#b38cff)" },
    { id: "rail_party", g: "rail", slot: "fx", name: "배송 축포", c: [600, 15, 3], p: [9000, 5], col: "radial-gradient(circle,#ffcf3a 15%,#ff6fb5 40%,#3bd1ff 70%)" },
    // 99 · 카드 뒷면
    { id: "nn_wafer", g: "nn", slot: "back", name: "웨이퍼 뒷면", c: [300, 20, 0], p: [4500, 3], col: "conic-gradient(#7f8fb5,#c7b4e6,#9fe0e8,#c9e7a8,#e8c79f,#7f8fb5)" },
    { id: "nn_pcb", g: "nn", slot: "back", name: "회로 기판 뒷면", c: [400, 20, 1], p: [6000, 4], col: "linear-gradient(135deg,#0f5a3a 60%,#e3b04a 60%)" },
    { id: "nn_gold", g: "nn", slot: "back", name: "금박 뒷면", c: [700, 20, 4], p: [11000, 5], col: "repeating-linear-gradient(45deg,#c8961e 0 4px,#e8bd4a 4px 8px)" },
  ];

  // ---------- 출근 도장 ----------
  const ATT_REWARD = [20, 25, 30, 35, 40, 45, 100];
  let attToday = null;
  function checkIn() {
    const d = today();
    if (S.att.last === d) return null;
    S.att.streak = S.att.last === yesterday() ? S.att.streak + 1 : 1;
    S.att.last = d; S.att.days++;
    const r = ATT_REWARD[(S.att.streak - 1) % 7];
    S.wafers += r; S.earned += r;
    attToday = { streak: S.att.streak, r, out: { earned: 0, lines: [] } };
    sweep("", {}, attToday.out);
    save();
    return attToday;
  }

  // 업적 훑기: 새로 열린 업적은 웨이퍼를 주고 쪽지 줄에 적는다 (웨이퍼로 열리는 업적이 또 열릴 수 있어 두 번 훑는다)
  function sweep(g, s, out) {
    for (let pass = 0; pass < 2; pass++) for (const a of ACH) {
      if (S.ach[a.id]) continue;
      let ok = false; try { ok = a.ok(g, s || {}); } catch (e) {}
      if (ok) { S.ach[a.id] = today(); S.wafers += a.r; S.earned += a.r; out.earned += a.r; out.lines.push(["업적", a.label, a.r]); }
    }
  }

  // ---------- 판 결과 보고 ----------
  function report(g, s) {
    rollDay();
    const tot = S.tot[g] || (S.tot[g] = {}), best = S.best[g] || (S.best[g] = {});
    s = Object.assign({ plays: 1 }, s);
    for (const k in s) {
      const v = typeof s[k] === "boolean" ? (s[k] ? 1 : 0) : +s[k] || 0;
      tot[k] = (tot[k] || 0) + v; best[k] = Math.max(best[k] || 0, v);
    }
    const out = { earned: 0, lines: [] };
    const base = Math.min(10, Math.max(1, Math.round(EARN[g] ? EARN[g](s) : 0)));
    out.earned += base;
    // 오늘의 공정
    for (const m of S.mis) {
      const def = missionDef(m.id); if (!def || m.done || def.g !== g) continue;
      const v = def.k === "plays" ? 1 : def.k === "wins" ? (s.win ? 1 : 0) : (+s[def.k] || 0);
      m.v = def.mode === "max" ? Math.max(m.v, v) : m.v + v;
      if (m.v >= def.t) { m.done = true; S.misDone = (S.misDone || 0) + 1; out.earned += def.r; out.lines.push(["오늘의 공정 완료", def.label, def.r]); }
    }
    if (!S.bonus && S.mis.length && S.mis.every(m => m.done)) { S.bonus = true; S.fullDays = (S.fullDays || 0) + 1; out.earned += ALL_DONE_BONUS; out.lines.push(["오늘의 공정 전부 완료", "보너스", ALL_DONE_BONUS]); }
    S.wafers += out.earned; S.earned += out.earned;
    // 업적 (웨이퍼가 들어온 뒤에 따져야 '웨이퍼 부자'가 바로 열린다)
    sweep(g, s, out);
    // 이번 판에 쓴 코팅은 한 판씩 닳는다
    for (const k in S.equip) {
      const id = S.equip[k]; if (!id || !k.startsWith(g + ".") || S.owned.includes(id)) continue;
      S.uses[id] = Math.max(0, (S.uses[id] || 0) - 1);
      if (!S.uses[id]) { S.equip[k] = null; const it = SHOP.find(i => i.id === id); out.lines.push(["코팅 수명 끝", it ? it.name : "꾸미기", 0]); }
    }
    // 승진
    const r0 = rankOf(S.earned - out.earned), r1 = rankOf(S.earned);
    if (r1 > r0) out.lines.unshift(["승진", `${RANKS[r1].name}(으)로!`, 0]);
    out.base = base;
    save();
    toast(out);
    return out;
  }

  // ---------- 결과 쪽지 (화면 위, 터치를 가로막지 않는다) ----------
  let styleDone = false;
  function ensureStyle() {
    if (styleDone) return; styleDone = true;
    const st = document.createElement("style");
    st.textContent = `
      .fab-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 10px); transform: translate(-50%, -12px); z-index: 9999;
        min-width: min(300px, calc(100vw - 32px)); max-width: calc(100vw - 32px); pointer-events: none; opacity: 0; transition: opacity .25s, transform .25s;
        background: rgba(4, 20, 15, .94); color: #e6fff4; border: 1.5px solid rgba(93, 255, 195, .55); border-radius: 14px; padding: 10px 14px;
        font: 600 14px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; box-shadow: 0 0 24px rgba(93, 255, 195, .25), 0 10px 30px rgba(0, 0, 0, .5); }
      .fab-toast.on { opacity: 1; transform: translate(-50%, 0); }
      .fab-toast .big { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 900; color: #5dffc3; }
      .fab-toast .row { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; font-size: 13px; }
      .fab-toast .row b { color: #ffb547; font-weight: 700; } .fab-toast .row span:last-child { color: #5dffc3; white-space: nowrap; }
      .fab-coin { width: 18px; height: 18px; border-radius: 50%; flex: none;
        background: radial-gradient(circle at 35% 30%, #fff, #b7c4dd 35%, #8fa0c4 60%, #c8b8ee 80%, #9fd6d0); box-shadow: 0 0 0 1.5px rgba(255,255,255,.5) inset; }`;
    document.head.appendChild(st);
  }
  let toastEl = null, toastTimer = 0;
  function toast(o, title) {
    if (typeof document === "undefined" || !document.body) return;
    ensureStyle();
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "fab-toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    const esc = t => String(t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    toastEl.innerHTML = `<div class="big"><i class="fab-coin"></i>${esc(title || `웨이퍼 +${o.earned}`)}</div>` +
      o.lines.slice(0, 6).map(([a, b, r]) => `<div class="row"><span><b>${esc(a)}</b> ${esc(b)}</span><span>${r ? "+" + r : ""}</span></div>`).join("") +
      (o.lines.length > 6 ? `<div class="row"><span>그 밖에 ${o.lines.length - 6}개</span><span>+${o.lines.slice(6).reduce((t, l) => t + (l[2] || 0), 0)}</span></div>` : "") +
      `<div class="row" style="opacity:.7"><span>보유 웨이퍼</span><span>${S.wafers.toLocaleString("ko-KR")}장</span></div>`;
    void toastEl.offsetWidth; toastEl.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), 3600 + Math.min(o.lines.length, 7) * 600);
  }

  // ---------- 상점 ----------
  const rank = () => rankOf(S.earned);
  // kind: "c" 코팅(판 수만큼) · "p" 소장판(영구)
  function buy(id, kind) {
    const it = SHOP.find(i => i.id === id); if (!it) return false;
    const [price, , need] = kind === "p" ? [it.p[0], 0, it.p[1]] : it.c;
    if (kind === "p" && S.owned.includes(id)) return false;
    if (rank() < need || S.wafers < price) return false;
    S.wafers -= price; S.buys = (S.buys || 0) + 1;
    if (kind === "p") S.owned.push(id); else S.uses[id] = (S.uses[id] || 0) + it.c[1];
    S.equip[it.g + "." + it.slot] = id;
    const o = { earned: 0, lines: [] }; sweep("", {}, o); lastBuy = o;
    save(); return true;
  }
  let lastBuy = null;
  const has = id => S.owned.includes(id) || (S.uses[id] || 0) > 0;
  function equip(id) {
    const it = SHOP.find(i => i.id === id); if (!it || !has(id)) return;
    const k = it.g + "." + it.slot;
    S.equip[k] = S.equip[k] === id ? null : id; save();
  }
  const equipped = (g, slot) => { const id = S.equip[g + "." + slot]; return id && has(id) ? id : null; };

  rollDay();
  // 페이지를 열면 출근 도장: 오늘 처음이면 웨이퍼를 주고 쪽지를 띄운다
  function stamp() {
    const a = checkIn();
    if (S.notice) { const n = S.notice; delete S.notice; save(); if (!a) return toast(n, n.title); setTimeout(() => toast(n, n.title), 4200); }
    if (a) toast({ earned: a.r, lines: a.out.lines }, `출근 도장 ${a.streak}일째 · 웨이퍼 +${a.r}`);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", stamp); else setTimeout(stamp, 0);
  window.FAB = {
    S, GAMES, MISSIONS, ACH, SHOP, SLOTS, RANKS, ALL_DONE_BONUS,
    report, checkIn, buy, equip, equipped, has, rank, rankOf, rollDay, toast, save,
    missionDef, get attToday() { return attToday; }, get lastBuy() { return lastBuy; },
    reload() { Object.assign(S, load()); S.uses = S.uses || {}; rollDay(); },
  };
})();
