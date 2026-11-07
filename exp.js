// ===== ระบบ EXP / Level / ฉายา / EXP x2 =====
// ข้อมูลใน Firestore:  players/{แฮชชื่อ}  expLog/{ชนิด_รหัสรายการ}  settings/exp
import { doc, runTransaction, increment, onSnapshot, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { nameKey, dateKey } from "./tracker.js";

// ===== ตั้งค่า (แก้ตรงนี้) =====
// cap = จำนวนครั้งสูงสุดต่อวันที่ได้ EXP (กันปั๊มคะแนน)
export const REWARDS = {
  homework: { exp: 25, cap: 3, label: "เพิ่มการบ้าน" },
  note: { exp: 30, cap: 3, label: "เพิ่มสิ่งที่เรียน" },
  comment: { exp: 3, cap: 5, label: "แสดงความคิดเห็น" },
  daily: { exp: 25, cap: 1, label: "เข้าใช้งานประจำวัน" },
  duty: { exp: 15, cap: 1, label: "ส่งรายงานเวร" },
  inspect: { exp: 15, cap: 1, label: "ตรวจสอบห้องเรียน" }
};
export const ADMIN_PASSWORD = "admin-C137"; // *** เปลี่ยนก่อนใช้จริง ***

const TITLES = [
  { min: 50, th: "ระดับราชา", en: "King", color: "#8a5a00", solid: "#d99a00", bg: "linear-gradient(135deg,#ffe28a,#f5b800)" },
  { min: 40, th: "ระดับจอมมาร", en: "Demon Lord", color: "#9b111e", solid: "#9b111e", bg: "#f9dde0" },
  { min: 30, th: "ระดับจักรพรรดิ", en: "Emperor", color: "#8f6b00", solid: "#b8900a", bg: "#fbf0c8" },
  { min: 20, th: "ระดับตำนาน", en: "Legend", color: "#c25a0a", solid: "#d4680f", bg: "#fdebd8" },
  { min: 15, th: "ระดับผู้พิชิต", en: "Conqueror", color: "#6b46a8", solid: "#7a56b5", bg: "#efe8f8" },
  { min: 10, th: "ระดับจอมยุทธ์", en: "Warrior", color: "#0f6cbd", solid: "#0f6cbd", bg: "#e3effa" },
  { min: 5, th: "ระดับผู้กล้า", en: "Hero", color: "#107c10", solid: "#107c10", bg: "#e3f4e3" },
  { min: 1, th: "ระดับเริ่มต้น", en: "Novice", color: "#6b7280", solid: "#6b7280", bg: "#f0f1f3" }
];

// ===== Level: ต้องใช้ 100 + 8 x (เลเวลปัจจุบัน - 1) EXP เพื่อไปเลเวลถัดไป =====
export function levelInfo(exp) {
  exp = Math.max(0, Math.floor(exp || 0));
  let level = 1, left = exp, need = 100;
  while (left >= need) { left -= need; level++; need = 100 + 8 * (level - 1); }
  return { level: level, into: left, need: need, remain: need - left, pct: Math.round((left / need) * 100), total: exp };
}
export function titleFor(level) {
  return TITLES.filter(function (t) { return level >= t.min; })[0];
}

// ===== คีย์ช่วงเวลา (สัปดาห์เริ่มวันจันทร์) =====
export function periodKeys(d) {
  d = d || new Date();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return { day: dateKey(d), month: "m" + dateKey(d).slice(0, 7).replace("-", ""), week: "w" + dateKey(mon).replace(/-/g, "") };
}

// ===== EXP x2 =====
export function eventActive(cfg, now) { return !!(cfg && cfg.enabled && cfg.startAt <= now && now < cfg.endAt); }
export function watchEvent(db, cb) {
  return onSnapshot(doc(db, "settings", "exp"), function (s) { cb(s.exists() ? s.data() : null); }, function () { cb(null); });
}
export function saveEvent(db, cfg) { return setDoc(doc(db, "settings", "exp"), cfg); }
export function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return (d ? d + " วัน " : "") + (d || h ? h + " ชม. " : "") + (m % 60) + " นาที";
}

// ===== ให้ EXP (ทำเป็นธุรกรรมเดียว กันซ้ำด้วย expLog + จำกัดต่อวัน) =====
export async function awardExp(db, user, type, refId) {
  const cfg = REWARDS[type];
  if (!cfg || !user || !user.name || !refId) return null;
  try {
    const key = nameKey(user.name), now = new Date(), pk = periodKeys(now);
    const pRef = doc(db, "players", key);
    const lRef = doc(db, "expLog", type + "_" + refId);
    const sRef = doc(db, "settings", "exp");
    const res = await runTransaction(db, async function (tx) {
      const s = await Promise.all([tx.get(lRef), tx.get(pRef), tx.get(sRef)]);
      if (s[0].exists()) return { amount: 0, reason: "dup" };          // เคยให้ EXP รายการนี้แล้ว
      const d = s[1].exists() ? s[1].data() : null;
      const counts = d && d.dayKey === pk.day ? Object.assign({}, d.dayCount || {}) : {};
      if ((counts[type] || 0) >= cfg.cap) return { amount: 0, reason: "cap" };
      const mult = eventActive(s[2].exists() ? s[2].data() : null, now.getTime()) ? 2 : 1;
      const amount = cfg.exp * mult;
      counts[type] = (counts[type] || 0) + 1;
      const before = d ? d.exp || 0 : 0;
      const base = { name: user.name, lastAt: now.getTime(), dayKey: pk.day, dayCount: counts };
      if (!d) {
        base.exp = amount; base.month = {}; base.month[pk.month] = amount; base.week = {}; base.week[pk.week] = amount;
        tx.set(pRef, base);
      } else {
        base.exp = increment(amount);
        base["month." + pk.month] = increment(amount);
        base["week." + pk.week] = increment(amount);
        tx.update(pRef, base);
      }
      tx.set(lRef, { player: key, name: user.name, type: type, base: cfg.exp, mult: mult, amount: amount, at: now.getTime(), refId: refId });
      return { amount: amount, mult: mult, before: before, after: before + amount };
    });
    showResult(res, cfg);
    return res;
  } catch (e) { console.error("ให้ EXP ไม่สำเร็จ", e); return null; }
}

// ย้ายข้อมูล EXP ไปชื่อใหม่ตอนเปลี่ยนชื่อ (ถ้าชื่อใหม่ยังไม่มีบัญชี)
export function renamePlayer(db, oldName, newName) {
  const a = nameKey(oldName), b = nameKey(newName);
  if (a === b) return Promise.resolve();
  const work = runTransaction(db, async function (tx) {
    const oRef = doc(db, "players", a), nRef = doc(db, "players", b);
    const s = await Promise.all([tx.get(oRef), tx.get(nRef)]);
    if (!s[0].exists() || s[1].exists()) return;
    tx.set(nRef, Object.assign({}, s[0].data(), { name: newName }));
    tx.delete(oRef);
  });
  return Promise.race([work, new Promise(function (r) { setTimeout(r, 3000); })]).catch(function (e) { console.error(e); });
}

// ===== ส่วนแสดงผล: ป้ายใน Header, ป๊อปอัปได้ EXP, Level Up =====
const css = ".exp-chip{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;color:inherit;text-decoration:none;background:var(--surface);border:1px solid var(--border);border-radius:999px;transition:border-color .15s}" +
  ".exp-chip:hover{border-color:var(--brand)}.exp-lv{font-size:.8rem;font-weight:700}" +
  ".exp-track{width:64px;height:6px;overflow:hidden;background:#e5e7eb;border-radius:999px}" +
  ".exp-fill{display:block;width:0;height:100%;background:var(--brand);border-radius:999px;transition:width .6s ease}" +
  ".exp-num{font-size:.72rem;color:var(--muted)}" +
  ".x2-badge{display:inline-flex;align-items:center;gap:2px;padding:1px 7px;font-size:.68rem;font-weight:700;color:#fff;background:#0b4f8a;border-radius:999px}.x2-badge[hidden]{display:none}" +
  ".x2-badge svg{width:11px;height:11px}" +
  ".exp-toast{position:fixed;left:50%;bottom:24px;z-index:60;display:flex;align-items:center;gap:8px;padding:10px 18px;font-size:.9rem;color:#fff;background:#242424;border-radius:999px;box-shadow:var(--shadow-3);transform:translateX(-50%);animation:expIn .25s ease}" +
  "@keyframes expIn{from{opacity:0;transform:translate(-50%,10px)}}" +
  ".lvup-overlay{position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(0,0,0,.5);animation:expFade .2s}" +
  "@keyframes expFade{from{opacity:0}}@keyframes expPop{from{opacity:0;transform:scale(.8)}}" +
  ".lvup-card{width:min(320px,88vw);padding:28px 24px;text-align:center;background:#fff;border-radius:16px;box-shadow:var(--shadow-3);animation:expPop .35s cubic-bezier(.2,1.2,.3,1)}" +
  ".lvup-kicker{font-size:.8rem;font-weight:700;letter-spacing:.2em;color:var(--brand)}.lvup-level{margin:6px 0;font-size:3rem;font-weight:700;line-height:1.1}" +
  ".lvup-title{font-weight:600}.lvup-title small{display:block;font-size:.75rem;font-weight:400;color:var(--muted)}" +
  ".lvup-unlock{display:inline-block;margin-top:10px;padding:2px 12px;font-size:.8rem;color:#fff;background:var(--brand);border-radius:999px}" +
  ".lvup-card button{display:block;margin:16px auto 0}" +
  "@media(max-width:640px){.exp-num{display:none}.exp-track{width:40px}}" +
  "@media(max-width:480px){.topbar .brand{font-size:0}}";
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);

function div(cls, html) { const e = document.createElement("div"); e.className = cls; if (html) e.innerHTML = html; return e; }

export function expToast(text, icon) {
  const t = div("exp-toast", '<i data-lucide="' + (icon || "sparkles") + '"></i>');
  t.appendChild(document.createTextNode(text));
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3000);
}

function showResult(res, cfg) {
  if (!res || res.reason === "dup") return;
  if (res.reason === "cap") { expToast("วันนี้ได้ EXP จาก" + cfg.label + "ครบ " + cfg.cap + " ครั้งแล้ว", "info"); return; }
  expToast("+" + res.amount + " EXP" + (res.mult > 1 ? " (x2)" : ""), res.mult > 1 ? "zap" : "sparkles");
  const a = levelInfo(res.before).level, b = levelInfo(res.after).level;
  if (b > a) levelUp(a, b);
}

function levelUp(from, to) {
  const t1 = titleFor(from), t2 = titleFor(to);
  const ov = div("lvup-overlay");
  const card = div("lvup-card", '<div class="lvup-kicker">LEVEL UP!</div>');
  const lv = div("lvup-level", ""); lv.textContent = "Lv." + to; lv.style.color = t2.solid;
  const ti = div("lvup-title", ""); ti.textContent = t2.th;
  const en = document.createElement("small"); en.textContent = t2.en; ti.appendChild(en);
  card.append(lv, ti);
  if (t1 !== t2) card.appendChild(div("lvup-unlock", "ปลดล็อกระดับใหม่"));
  const ok = document.createElement("button");
  ok.className = "btn-primary"; ok.textContent = "ไปต่อ";
  card.appendChild(ok); ov.appendChild(card); document.body.appendChild(ov);
  const close = function () { ov.remove(); };
  ok.addEventListener("click", close);
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  setTimeout(close, 8000);
}

// ป้าย Lv + หลอด EXP ข้างชื่อผู้ใช้ใน Header (กดแล้วไปหน้า Ranking)
export function initExpUI(db, user) {
  const slot = document.getElementById("userName");
  if (!slot || document.getElementById("expChip")) return;
  const chip = document.createElement("a");
  chip.id = "expChip"; chip.className = "exp-chip"; chip.href = "ranking.html";
  chip.innerHTML = '<span class="exp-lv">Lv.1</span><span class="exp-track"><span class="exp-fill"></span></span>' +
    '<span class="exp-num">0 / 100</span><span class="x2-badge" hidden><i data-lucide="zap"></i>x2</span>';
  slot.parentNode.insertBefore(chip, slot);
  const q = function (c) { return chip.querySelector(c); };
  let evt = null;

  onSnapshot(doc(db, "players", nameKey(user.name)), function (snap) {
    const exp = snap.exists() ? snap.data().exp || 0 : 0;
    const li = levelInfo(exp), t = titleFor(li.level);
    q(".exp-lv").textContent = "Lv." + li.level;
    q(".exp-lv").style.color = t.solid;
    q(".exp-fill").style.width = li.pct + "%";
    q(".exp-num").textContent = li.into + " / " + li.need;
    chip.title = t.th + " · EXP สะสม " + exp.toLocaleString("th-TH") + " · อีก " + li.remain + " EXP ถึง Lv." + (li.level + 1) + " (" + li.pct + "%)";
  }, function () {});
  const badge = function () { q(".x2-badge").hidden = !eventActive(evt, Date.now()); };
  watchEvent(db, function (cfg) { evt = cfg; badge(); });
  setInterval(badge, 30000);
}

// ===== EXP เข้าเว็บรายวัน: +25 ครั้งเดียวต่อบัญชีต่อวัน (เรียกจาก setupCommon) =====
export async function claimDaily(db, user) {
  const key = nameKey(user.name), today = dateKey();
  const mark = today + "|" + key;
  if (localStorage.getItem("dailyExp") === mark) return;       // เครื่องนี้ขอวันนี้แล้ว
  const res = await awardExp(db, user, "daily", key + "_" + today); // กันซ้ำด้วย expLog
  if (res) localStorage.setItem("dailyExp", mark);
}