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

  const GAMES = { chip: "칩 쌓기", bugs: "버그 잡기", baseball: "야구왕", zero: "ZERO RUN", nn: "99" };

  // ---------- 웨이퍼 정산: 한 판 기록 → 웨이퍼 ----------
  const EARN = {
    chip: s => (s.layers || 0) + Math.floor((s.perfect || 0) / 2),
    bugs: s => Math.floor((s.score || 0) / 4),
    baseball: s => (s.runs || 0) * 2 + (s.hits || 0) + (s.hr || 0) * 2,
    zero: s => Math.floor((s.bytes || 0) / 16),
    nn: s => (s.win ? 8 : 2),
  };

  // ---------- 오늘의 공정: 날마다 서로 다른 게임에서 세 가지 ----------
  // mode sum: 오늘 하루 동안 더한 값, max: 오늘 한 판에서 낸 가장 큰 값
  const MISSIONS = [
    { id: "chip12", g: "chip", k: "layers", t: 12, mode: "max", label: "칩 12단 쌓기", r: 20 },
    { id: "chipPerf", g: "chip", k: "perfect", t: 15, mode: "sum", label: "칩 쌓기에서 딱! 15번", r: 20 },
    { id: "bug40", g: "bugs", k: "caught", t: 40, mode: "sum", label: "버그 40마리 잡기", r: 20 },
    { id: "bug60", g: "bugs", k: "score", t: 60, mode: "max", label: "버그 잡기 한 판 60점", r: 25 },
    { id: "hit5", g: "baseball", k: "hits", t: 5, mode: "sum", label: "야구왕 안타 5개", r: 20 },
    { id: "hr1", g: "baseball", k: "hr", t: 1, mode: "sum", label: "야구왕 홈런 1개", r: 25 },
    { id: "run6", g: "baseball", k: "runs", t: 6, mode: "max", label: "야구왕 한 판 6점", r: 30 },
    { id: "zr150", g: "zero", k: "bytes", t: 150, mode: "max", label: "ZERO RUN 150B 달리기", r: 25 },
    { id: "zr3", g: "zero", k: "plays", t: 3, mode: "sum", label: "ZERO RUN 3판", r: 15 },
    { id: "nn1", g: "nn", k: "wins", t: 1, mode: "sum", label: "99에서 1번 이기기", r: 20 },
    { id: "nn3", g: "nn", k: "plays", t: 3, mode: "sum", label: "99 3판", r: 15 },
  ];
  const ALL_DONE_BONUS = 30;
  function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
  function rollDay() {
    const d = today();
    if (S.day === d && S.mis.length) return;
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
  const ACH = [
    { id: "first", label: "첫 출근", desc: "아무 게임이나 한 판", r: 5, ok: () => true },
    { id: "all5", label: "전 라인 순회", desc: "다섯 게임을 모두 한 판씩", r: 20, ok: () => Object.keys(GAMES).every(g => (S.tot[g] || {}).plays) },
    { id: "chip8", label: "HBM3 양산", desc: "칩 8단 쌓기", r: 15, ok: (g, s) => g === "chip" && s.layers >= 8 },
    { id: "chip12", label: "HBM3E 양산", desc: "칩 12단 쌓기", r: 30, ok: (g, s) => g === "chip" && s.layers >= 12 },
    { id: "chip16", label: "HBM4 양산", desc: "칩 16단 쌓기", r: 60, ok: (g, s) => g === "chip" && s.layers >= 16 },
    { id: "chip20", label: "세상에 없는 칩", desc: "칩 20단 쌓기", r: 125, ok: (g, s) => g === "chip" && s.layers >= 20 },
    { id: "perf10", label: "TSV 정렬 장인", desc: "칩 쌓기 딱! 10연속", r: 50, ok: (g, s) => g === "chip" && s.maxCombo >= 10 },
    { id: "bug50", label: "선임 엔지니어", desc: "버그 잡기 한 판 45점", r: 20, ok: (g, s) => g === "bugs" && s.score >= 45 },
    { id: "bug90", label: "버그 헌터", desc: "버그 잡기 한 판 90점", r: 60, ok: (g, s) => g === "bugs" && s.score >= 90 },
    { id: "bug500", label: "방역 반장", desc: "버그 500마리 누적", r: 40, ok: () => ((S.tot.bugs || {}).caught || 0) >= 500 },
    { id: "hr", label: "첫 홈런", desc: "야구왕에서 홈런", r: 10, ok: (g, s) => g === "baseball" && s.hr >= 1 },
    { id: "b2b", label: "백투백", desc: "두 타자 연속 홈런", r: 30, ok: (g, s) => g === "baseball" && s.b2b },
    { id: "steal", label: "대도", desc: "도루 성공", r: 10, ok: (g, s) => g === "baseball" && s.steals >= 1 },
    { id: "runs10", label: "빅이닝", desc: "야구왕 한 판 10점", r: 50, ok: (g, s) => g === "baseball" && s.runs >= 10 },
    { id: "ace", label: "괴물 사냥", desc: "괴물 투수를 끌어내기 (20점)", r: 100, ok: (g, s) => g === "baseball" && s.runs >= 20 },
    { id: "zr100", label: "100B 통과", desc: "ZERO RUN 100B", r: 15, ok: (g, s) => g === "zero" && s.bytes >= 100 },
    { id: "zr250", label: "커널 패닉 생존", desc: "ZERO RUN 250B", r: 60, ok: (g, s) => g === "zero" && s.bytes >= 250 },
    { id: "nn1", label: "레지스터 장악", desc: "99 첫 승", r: 10, ok: (g, s) => g === "nn" && s.win },
    { id: "nn3", label: "오버클럭", desc: "99 3연승", r: 40, ok: (g, s) => g === "nn" && s.streak >= 3 },
    { id: "att7", label: "개근상", desc: "7일 연속 출근", r: 50, ok: () => S.att.streak >= 7 },
    { id: "w1000", label: "웨이퍼 부자", desc: "웨이퍼 누적 1,000장", r: 25, ok: () => S.earned >= 1000 },
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
  const SHOP = [
    { id: "chip_neon", g: "chip", slot: "skin", name: "네온 핑크 칩", c: [250, 20, 0], p: [4000, 3], col: "#ff6fb5" },
    { id: "chip_gold", g: "chip", slot: "skin", name: "금 도금 칩", c: [400, 20, 2], p: [6000, 4], col: "#ffcf3a" },
    { id: "chip_rainbow", g: "chip", slot: "skin", name: "무지개 웨이퍼 칩", c: [600, 20, 3], p: [9000, 5], col: "linear-gradient(90deg,#ff5a6a,#ffcf3a,#5dffc3,#3bd1ff,#b38cff)" },
    { id: "bb_sky", g: "baseball", slot: "ball", name: "하늘 전자 공", c: [250, 15, 0], p: [4000, 3], col: "#3bd1ff" },
    { id: "bb_pink", g: "baseball", slot: "ball", name: "핑크 전자 공", c: [250, 15, 1], p: [4000, 3], col: "#ff6fb5" },
    { id: "bb_gold", g: "baseball", slot: "ball", name: "금빛 전자 공", c: [400, 15, 2], p: [6000, 4], col: "#ffcf3a" },
    { id: "bug_bolt", g: "bugs", slot: "fx", name: "번개 손맛", c: [300, 20, 1], p: [5000, 3], col: "#ffe14a" },
    { id: "bug_fire", g: "bugs", slot: "fx", name: "폭죽 손맛", c: [500, 20, 2], p: [8000, 4], col: "linear-gradient(90deg,#ff5a6a,#ffcf3a,#5dffc3,#3bd1ff)" },
    { id: "zr_sky", g: "zero", slot: "glow", name: "하늘빛 0", c: [250, 20, 0], p: [4000, 3], col: "#3bd1ff" },
    { id: "zr_pink", g: "zero", slot: "glow", name: "핑크빛 0", c: [250, 20, 1], p: [4000, 3], col: "#ff6fb5" },
    { id: "zr_gold", g: "zero", slot: "glow", name: "금빛 0", c: [400, 20, 2], p: [6000, 4], col: "#ffcf3a" },
  ];

  // ---------- 출근 도장 ----------
  const ATT_REWARD = [10, 12, 15, 18, 20, 25, 60];
  let attToday = null;
  function checkIn() {
    const d = today();
    if (S.att.last === d) return null;
    S.att.streak = S.att.last === yesterday() ? S.att.streak + 1 : 1;
    S.att.last = d; S.att.days++;
    const r = ATT_REWARD[(S.att.streak - 1) % 7];
    S.wafers += r; S.earned += r;
    attToday = { streak: S.att.streak, r };
    save();
    return attToday;
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
    const base = Math.max(1, Math.round(EARN[g] ? EARN[g](s) : 0));
    out.earned += base;
    // 오늘의 공정
    for (const m of S.mis) {
      const def = missionDef(m.id); if (!def || m.done || def.g !== g) continue;
      const v = def.k === "plays" ? 1 : def.k === "wins" ? (s.win ? 1 : 0) : (+s[def.k] || 0);
      m.v = def.mode === "max" ? Math.max(m.v, v) : m.v + v;
      if (m.v >= def.t) { m.done = true; out.earned += def.r; out.lines.push(["오늘의 공정 완료", def.label, def.r]); }
    }
    if (!S.bonus && S.mis.length && S.mis.every(m => m.done)) { S.bonus = true; out.earned += ALL_DONE_BONUS; out.lines.push(["오늘의 공정 전부 완료", "보너스", ALL_DONE_BONUS]); }
    S.wafers += out.earned; S.earned += out.earned;
    // 업적 (웨이퍼가 들어온 뒤에 따져야 '웨이퍼 부자'가 바로 열린다)
    for (const a of ACH) {
      if (S.ach[a.id]) continue;
      let ok = false; try { ok = a.ok(g, s); } catch (e) {}
      if (ok) { S.ach[a.id] = today(); S.wafers += a.r; S.earned += a.r; out.earned += a.r; out.lines.push(["업적", a.label, a.r]); }
    }
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
      o.lines.map(([a, b, r]) => `<div class="row"><span><b>${esc(a)}</b> ${esc(b)}</span><span>${r ? "+" + r : ""}</span></div>`).join("") +
      `<div class="row" style="opacity:.7"><span>보유 웨이퍼</span><span>${S.wafers.toLocaleString("ko-KR")}장</span></div>`;
    void toastEl.offsetWidth; toastEl.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), 3600 + o.lines.length * 600);
  }

  // ---------- 상점 ----------
  const rank = () => rankOf(S.earned);
  // kind: "c" 코팅(판 수만큼) · "p" 소장판(영구)
  function buy(id, kind) {
    const it = SHOP.find(i => i.id === id); if (!it) return false;
    const [price, , need] = kind === "p" ? [it.p[0], 0, it.p[1]] : it.c;
    if (kind === "p" && S.owned.includes(id)) return false;
    if (rank() < need || S.wafers < price) return false;
    S.wafers -= price;
    if (kind === "p") S.owned.push(id); else S.uses[id] = (S.uses[id] || 0) + it.c[1];
    S.equip[it.g + "." + it.slot] = id; save(); return true;
  }
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
    if (a) toast({ earned: a.r, lines: [] }, `출근 도장 ${a.streak}일째 · 웨이퍼 +${a.r}`);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", stamp); else setTimeout(stamp, 0);
  window.FAB = {
    S, GAMES, MISSIONS, ACH, SHOP, RANKS, ALL_DONE_BONUS,
    report, checkIn, buy, equip, equipped, has, rank, rankOf, rollDay, toast, save,
    missionDef, get attToday() { return attToday; },
    reload() { Object.assign(S, load()); S.uses = S.uses || {}; rollDay(); },
  };
})();
