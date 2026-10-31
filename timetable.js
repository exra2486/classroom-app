import { setupCommon } from "./common.js";
import { SLOTS, DAYS, GROUPS, ACTIVITY, TIMETABLE } from "./timetable-data.js";

if (!setupCommon()) throw new Error("no user");

const $ = function (id) { return document.getElementById(id); };
let selected = null; // วันที่เลือกในแท็บ (null = ใช้วันนี้)

// ===== ฟังก์ชันช่วย =====
function toMin(t) { const p = t.split("."); return Number(p[0]) * 60 + Number(p[1]); }
function groupOf(c) { return (c && c.code && GROUPS[c.code.charAt(0)]) || ACTIVITY; }
function fmtTime(t) { return t.replace("-", "–") + " น."; }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function metaItem(icon, text) {
  const s = el("span", "meta-item");
  s.innerHTML = '<i data-lucide="' + icon + '"></i>';
  s.appendChild(el("span", "", text));
  return s;
}

// วันนี้วันอะไร + ตอนนี้อยู่คาบไหน
function nowState() {
  const d = new Date();
  const day = d.getDay();
  const m = d.getHours() * 60 + d.getMinutes();
  const today = day >= 1 && day <= 5 ? day - 1 : -1;
  let slot = null;
  if (today >= 0) {
    SLOTS.forEach(function (s) {
      const r = s.time.split("-");
      if (m >= toMin(r[0]) && m < toMin(r[1])) slot = s.id;
    });
  }
  return { today: today, slot: slot };
}

// ===== สร้างการ์ดวิชา 1 ใบ =====
function buildCard(cell, slot, compact) {
  const card = el("div", "slot-card" + (compact ? " compact" : ""));

  if (slot.free) {
    card.classList.add("lunch");
    card.appendChild(el("div", "slot-title", "พักกลางวัน"));
    return card;
  }
  if (!cell) {
    card.classList.add("empty");
    card.appendChild(el("div", "slot-title", compact ? "–" : "ไม่มีเรียน"));
    return card;
  }

  const g = groupOf(cell);
  card.style.setProperty("--g", g.color);
  card.appendChild(el("div", "slot-title", cell.code || cell.title));

  const tags = el("div", "slot-tags");
  tags.appendChild(el("span", "chip", g.name));
  if (cell.note) tags.appendChild(el("span", "chip note", cell.note));
  card.appendChild(tags);

  if (cell.teacher || cell.room) {
    const meta = el("div", "slot-meta");
    if (cell.teacher) meta.appendChild(metaItem("user", cell.teacher));
    if (cell.room) meta.appendChild(metaItem("map-pin", "ห้อง " + cell.room));
    card.appendChild(meta);
  }
  return card;
}

// ===== วาดหน้าทั้งหมด =====
function render() {
  const st = nowState();
  if (selected === null) selected = st.today >= 0 ? st.today : 0;

  // ข้อความบอกสถานะตอนนี้
  const curSlot = SLOTS.filter(function (s) { return s.id === st.slot; })[0];
  const curCell = curSlot && !curSlot.free ? TIMETABLE[st.today][curSlot.id] : null;
  $("nowInfo").textContent = curCell
    ? "ตอนนี้ · " + curSlot.label + " " + (curCell.code || curCell.title)
    : st.today >= 0 ? "วันนี้วัน" + DAYS[st.today].name : "วันหยุดสุดสัปดาห์";

  // --- มือถือ: แท็บวัน + รายการคาบ ---
  const tabs = $("dayTabs");
  tabs.innerHTML = "";
  DAYS.forEach(function (d, i) {
    const b = el("button", "day-tab" + (i === selected ? " active" : "") + (i === st.today ? " today" : ""), d.short);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", i === selected ? "true" : "false");
    b.setAttribute("aria-label", "วัน" + d.name);
    b.addEventListener("click", function () { selected = i; render(); });
    tabs.appendChild(b);
  });

  $("dayTitle").textContent = "วัน" + DAYS[selected].name + (selected === st.today ? " · วันนี้" : "");

  const list = $("dayList");
  list.innerHTML = "";
  SLOTS.forEach(function (s) {
    const isNow = selected === st.today && s.id === st.slot;
    const row = el("li", "slot-row" + (isNow ? " now" : ""));
    const t = el("div", "slot-time");
    t.append(el("strong", "", s.label), el("span", "", fmtTime(s.time)));
    const card = buildCard(TIMETABLE[selected][s.id], s, false);
    if (isNow && !s.free) card.appendChild(el("span", "now-tag", "กำลังเรียน"));
    row.append(t, card);
    list.appendChild(row);
  });

  // --- จอกว้าง: ตารางเต็มสัปดาห์ ---
  const grid = $("weekGrid");
  grid.innerHTML = "";
  grid.appendChild(el("div", "wg-head wg-corner", "เวลา"));
  DAYS.forEach(function (d, i) {
    grid.appendChild(el("div", "wg-head" + (i === st.today ? " today" : ""), d.name));
  });
  SLOTS.forEach(function (s) {
    const tc = el("div", "wg-time");
    tc.append(el("strong", "", s.label), el("span", "", fmtTime(s.time)));
    grid.appendChild(tc);
    if (s.free) { grid.appendChild(el("div", "wg-lunch", "พักกลางวัน")); return; }
    DAYS.forEach(function (d, i) {
      const cell = el("div", "wg-cell" + (i === st.today ? " today" : "") + (i === st.today && s.id === st.slot ? " now" : ""));
      cell.appendChild(buildCard(TIMETABLE[i][s.id], s, true));
      grid.appendChild(cell);
    });
  });
}

// ===== คำอธิบายสี (สร้างครั้งเดียว) =====
const legend = $("legend");
Object.keys(GROUPS).map(function (k) { return GROUPS[k]; }).concat([ACTIVITY]).forEach(function (g) {
  const item = el("span", "legend-item", g.name);
  item.style.setProperty("--g", g.color);
  legend.appendChild(item);
});

render();
setInterval(render, 60000); // อัปเดตคาบปัจจุบันทุกนาที
