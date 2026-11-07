import { db, setupCommon, getUser, collection, onSnapshot } from "./common.js";
import { nameKey } from "./tracker.js";
import { levelInfo, titleFor, periodKeys, watchEvent, eventActive, saveEvent, fmtLeft, ADMIN_PASSWORD } from "./exp.js";

if (!setupCommon()) throw new Error("no user");

const $ = function (id) { return document.getElementById(id); };
const meKey = nameKey(getUser().name);
let players = null; // null = ยังโหลดไม่เสร็จ
let filter = "all";
let evt = null;

// ตำแหน่งบนกระดาน (เปลี่ยนตามอันดับ แยกจากฉายาระดับที่ถาวร)
const POS = [
  { badge: "KING", icon: "crown", cls: "gold" },
  { badge: "DUKE", icon: "medal", cls: "silver" },
  { badge: "KNIGHT", icon: "medal", cls: "bronze" }
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const fmt = function (n) { return n.toLocaleString("th-TH"); };

// EXP ของช่วงเวลาที่เลือก
function score(p) {
  const pk = periodKeys();
  if (filter === "month") return (p.month && p.month[pk.month]) || 0;
  if (filter === "week") return (p.week && p.week[pk.week]) || 0;
  return p.exp || 0;
}

// เรียงอันดับ: EXP มากก่อน ถ้าเท่ากัน คนที่ทำได้ก่อน (lastAt น้อยกว่า) ชนะ
function ranking() {
  return players.map(function (p) { return { p: p, v: score(p) }; })
    .filter(function (x) { return x.v > 0; })
    .sort(function (a, b) {
      return b.v - a.v || (a.p.lastAt || 0) - (b.p.lastAt || 0) || String(a.p.name).localeCompare(String(b.p.name), "th");
    });
}

function titleChip(level) {
  const t = titleFor(level);
  const c = el("span", "rk-title", t.th);
  c.style.color = t.color;
  c.style.background = t.bg;
  c.title = t.en;
  return c;
}
function avatar(p, level) {
  const a = el("span", "rk-avatar", String(p.name || "?").trim().charAt(0).toUpperCase());
  a.style.background = titleFor(level).solid;
  return a;
}

function podiumCard(entry, i) {
  const pos = POS[i];
  const card = el("div", "pod pod-" + (i + 1) + " " + pos.cls);
  if (!entry) {
    card.classList.add("pod-empty");
    card.appendChild(el("div", "", "ว่าง"));
    return card;
  }
  if (entry.p.key === meKey) card.classList.add("me");
  const li = levelInfo(entry.p.exp || 0);
  const top = el("div", "pod-top");
  top.innerHTML = '<i data-lucide="' + pos.icon + '"></i>';
  const meta = el("div", "pod-meta");
  meta.append(el("span", "", "Lv." + li.level), titleChip(li.level));
  card.append(top, avatar(entry.p, li.level), el("span", "pod-badge", pos.badge),
    el("div", "pod-name", entry.p.name), meta, el("div", "pod-exp", fmt(entry.v) + " EXP"));
  return card;
}

function render() {
  const pod = $("podium"), list = $("rankList"), st = $("rkState");
  pod.innerHTML = ""; list.innerHTML = "";
  if (players === null) { st.hidden = false; st.textContent = "กำลังโหลด..."; return; }
  const rows = ranking();
  if (!rows.length) {
    st.hidden = false;
    st.textContent = "ยังไม่มีใครได้ EXP ในช่วงนี้ มาเป็นคนแรกกัน เพิ่มการบ้านหรือสิ่งที่เรียนเพื่อสะสม EXP";
    return;
  }
  st.hidden = true;
  [1, 0, 2].forEach(function (i) { pod.appendChild(podiumCard(rows[i], i)); }); // ซ้าย=2 กลาง=1 ขวา=3

  rows.slice(3).forEach(function (r, idx) {
    const li = levelInfo(r.p.exp || 0);
    const row = el("li", "rk-row" + (r.p.key === meKey ? " me" : ""));
    const who = el("div", "rk-who");
    const line = el("div", "rk-lvline");
    line.append(el("span", "", "Lv." + li.level), titleChip(li.level));
    const name = el("div", "rk-name", r.p.name);
    if (r.p.key === meKey) name.appendChild(el("span", "rk-me", "คุณ"));
    who.append(name, line);
    const exp = el("div", "rk-exp", fmt(r.v));
    exp.appendChild(el("small", "", "EXP"));
    row.append(el("span", "rk-pos", String(idx + 4)), avatar(r.p, li.level), who, exp);
    list.appendChild(row);
  });
}

// ===== แบนเนอร์ EXP x2 =====
function banner() {
  const b = $("eventBanner"), now = Date.now();
  if (eventActive(evt, now)) {
    b.hidden = false;
    b.innerHTML = '<i data-lucide="zap"></i>';
    b.appendChild(document.createTextNode("EXP x2 กำลังเปิดอยู่ · เหลืออีก " + fmtLeft(evt.endAt - now)));
  } else b.hidden = true;
}

// ===== ผู้ดูแล: เปิด/ปิด EXP x2 =====
$("adminBtn").addEventListener("click", async function () {
  const pw = prompt("รหัสผู้ดูแล:");
  if (pw === null) return;
  if (pw !== ADMIN_PASSWORD) return alert("รหัสผู้ดูแลไม่ถูกต้อง");
  const h = prompt("เปิด EXP x2 กี่ชั่วโมง (นับจากตอนนี้)\nพิมพ์ 0 เพื่อปิด" + (eventActive(evt, Date.now()) ? "\n(ตอนนี้เปิดอยู่)" : ""), "24");
  if (h === null) return;
  const hours = Number(h);
  if (!isFinite(hours) || hours < 0 || hours > 720) return alert("กรุณาใส่ตัวเลข 0–720");
  const now = Date.now();
  await saveEvent(db, hours > 0
    ? { enabled: true, startAt: now, endAt: now + hours * 3600000 }
    : { enabled: false, startAt: 0, endAt: 0 });
});

// ===== ตัวกรอง All Time / Month / Week =====
document.querySelectorAll(".rk-seg button").forEach(function (b) {
  b.addEventListener("click", function () {
    filter = b.dataset.f;
    document.querySelectorAll(".rk-seg button").forEach(function (x) { x.classList.toggle("active", x === b); });
    render();
  });
});

onSnapshot(collection(db, "players"), function (snap) {
  players = snap.docs.map(function (d) { return Object.assign({ key: d.id }, d.data()); });
  render();
}, function () {
  players = null;
  $("rkState").hidden = false;
  $("rkState").textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ Firebase";
});
watchEvent(db, function (cfg) { evt = cfg; banner(); });
setInterval(function () { banner(); render(); }, 60000);
