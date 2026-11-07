import { db, setupCommon } from "./common.js";
import { monthKey, watchMonth } from "./tracker.js";

if (!setupCommon()) throw new Error("no user");

const $ = function (id) { return document.getElementById(id); };
const DAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]; // ลำดับตาม getDay()

const store = {};  // "2026-11" -> { "01": 5, "02": 8 }
const loaded = {}; // เดือนที่โหลดเสร็จแล้ว
const subs = {};   // เดือนที่กำลังฟังอยู่
let failed = false;
let mode = "week"; // "week" | "month"
let offset = 0;    // 0 = ช่วงปัจจุบัน, -1 = ก่อนหน้า, ...

// ===== ฟังก์ชันช่วย =====
function pad(n) { return String(n).padStart(2, "0"); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function fmtDay(d) { return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }); }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ===== ข้อมูล =====
function ensureMonth(key) {
  if (subs[key]) return;
  subs[key] = watchMonth(db, key, function (days) {
    if (days === null) failed = true; else store[key] = days;
    loaded[key] = true;
    render(false); // ข้อมูลเปลี่ยน -> วาดใหม่ (ไม่เล่นแอนิเมชันซ้ำ)
  });
}

function countOf(d) {
  const m = store[monthKey(d)];
  return m ? (m[pad(d.getDate())] || 0) : 0;
}

// วันแรกที่มีข้อมูล (ใช้ตัดวันก่อนเริ่มระบบออกจากค่าเฉลี่ย)
function firstDate() {
  let best = null;
  Object.keys(store).forEach(function (k) {
    Object.keys(store[k]).forEach(function (dd) {
      const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(dd));
      if (!best || d < best) best = d;
    });
  });
  return best;
}

// ช่วงที่ต้องแสดง: 7 วัน (จันทร์-อาทิตย์) หรือทั้งเดือน
function buildRange(t) {
  const days = [];
  let label;
  if (mode === "week") {
    const mon = addDays(t, -((t.getDay() + 6) % 7) + offset * 7);
    for (let i = 0; i < 7; i++) days.push(addDays(mon, i));
    label = fmtDay(days[0]) + " – " + fmtDay(days[6]) + " " +
      days[6].toLocaleDateString("th-TH", { year: "numeric" });
  } else {
    const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
    const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= n; i++) days.push(new Date(first.getFullYear(), first.getMonth(), i));
    label = first.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  }
  return { days: days, label: label };
}

// ===== การ์ดสรุป =====
function renderSummary(t) {
  const ready = loaded[monthKey(t)] && loaded[monthKey(addDays(t, -7))] && !failed;
  const set = function (id, v) { $(id).textContent = v; };
  if (!ready) {
    ["sumToday", "sumYesterday", "sumAvg", "sumMax"].forEach(function (id) { set(id, "–"); });
    set("sumMaxSub", "\u00a0");
    return;
  }
  const first = firstDate();
  const yest = addDays(t, -1);
  set("sumToday", countOf(t));
  set("sumYesterday", first && yest >= first ? countOf(yest) : "–");

  let sum = 0, n = 0;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(t, -i);
    if (first && d >= first) { sum += countOf(d); n++; }
  }
  set("sumAvg", n ? String(Math.round((sum / n) * 10) / 10) : "–");

  let best = 0, bestDay = null;
  for (let day = 1; day <= t.getDate(); day++) {
    const d = new Date(t.getFullYear(), t.getMonth(), day);
    const c = countOf(d);
    if (c > best) { best = c; bestDay = d; }
  }
  set("sumMax", best || "–");
  set("sumMaxSub", bestDay ? fmtDay(bestDay) : "\u00a0");
}

// ===== กราฟแท่ง =====
function renderChart(range, t, animate) {
  const chart = $("chart");
  $("rangeLabel").textContent = range.label;
  $("nextBtn").disabled = offset >= 0;
  $("modeWeek").classList.toggle("active", mode === "week");
  $("modeMonth").classList.toggle("active", mode === "month");
  $("emptyHint").hidden = !(Object.keys(loaded).length && !failed && firstDate() === null);

  const keys = {};
  range.days.forEach(function (d) { keys[monthKey(d)] = true; });
  const ready = Object.keys(keys).every(function (k) { return loaded[k]; });

  chart.className = "chart " + mode;
  chart.innerHTML = "";
  if (failed) { chart.appendChild(el("div", "chart-state", "โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ Firebase")); return; }
  if (!ready) { chart.appendChild(el("div", "chart-state", "กำลังโหลด...")); return; }
  if (animate) chart.classList.add("anim");

  const vals = range.days.map(function (d) { return d > t ? null : countOf(d); });
  const peak = Math.max.apply(null, [4].concat(vals.map(function (v) { return v || 0; })));
  const top = Math.ceil(peak / 4) * 4; // เพดานกราฟ หารด้วย 4 ลงตัวเสมอ

  // เส้นกริด + ตัวเลขแกน Y
  const grid = el("div", "grid");
  for (let k = 0; k <= 4; k++) {
    const gl = el("div", "gl");
    gl.style.bottom = (k * 25) + "%";
    gl.appendChild(el("span", "gy", String((top * k) / 4)));
    grid.appendChild(gl);
  }

  // แท่ง
  const bars = el("div", "bars");
  const total = range.days.length;
  range.days.forEach(function (d, i) {
    const v = vals[i];
    const isToday = d.getTime() === t.getTime();
    const when = DAY_SHORT[d.getDay()] + " " + fmtDay(d);
    const col = el("div", "bar-col" + (isToday ? " today-col" : ""));
    col.tabIndex = 0;
    col.setAttribute("role", "img");
    col.setAttribute("aria-label", when + (v === null ? " ยังไม่ถึงวัน" : " เข้าใช้ " + v + " คน"));

    const area = el("div", "bar-area");
    const edge = i < total * 0.3 ? " edge-l" : i > total * 0.7 ? " edge-r" : "";
    area.appendChild(el("div", "bar-tip" + edge, when + (v === null ? " · ยังไม่ถึงวัน" : " · " + v + " คน")));
    if (v) area.appendChild(el("div", "bar-val", String(v)));
    const bar = el("div", "bar" + (isToday ? " today" : "") + (v === null ? " future" : v === 0 ? " empty" : ""));
    if (v) bar.style.height = (v / top * 100) + "%";
    bar.style.setProperty("--i", i);
    area.appendChild(bar);

    const label = el("div", "bar-label" + (d.getDate() === 1 || d.getDate() % 5 === 0 ? " keep" : ""));
    if (mode === "week") {
      label.appendChild(el("b", "", DAY_SHORT[d.getDay()]));
      label.appendChild(document.createTextNode(String(d.getDate())));
    } else {
      label.textContent = String(d.getDate());
    }
    col.append(area, label);
    bars.appendChild(col);
  });
  chart.append(grid, bars);
}

function render(animate) {
  const t = startOfDay(new Date());
  const range = buildRange(t);
  const need = {};
  need[monthKey(t)] = true;
  need[monthKey(addDays(t, -7))] = true; // สำหรับ "เมื่อวาน" และค่าเฉลี่ย
  range.days.forEach(function (d) { need[monthKey(d)] = true; });
  Object.keys(need).forEach(ensureMonth);

  renderSummary(t);
  renderChart(range, t, animate);
}

// ===== ปุ่มควบคุม =====
$("modeWeek").addEventListener("click", function () { mode = "week"; offset = 0; render(true); });
$("modeMonth").addEventListener("click", function () { mode = "month"; offset = 0; render(true); });
$("prevBtn").addEventListener("click", function () { offset--; render(true); });
$("nextBtn").addEventListener("click", function () { if (offset < 0) { offset++; render(true); } });

render(true);
setInterval(function () { render(false); }, 60000); // เผื่อข้ามเที่ยงคืน
