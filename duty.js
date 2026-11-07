import { db, setupCommon, getUser, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion } from "./common.js";
import { runTransaction, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { dateKey, nameKey } from "./tracker.js";
import { awardExp, expToast, ADMIN_PASSWORD } from "./exp.js";
import { CHECKLIST, DAY_OVERRIDES, AREAS, TYPES } from "./duty-data.js";

if (!setupCommon()) throw new Error("no user");

// Firestore: dutyDays/{YYYY-MM-DD}  dutyIssues/{auto}  dutyWeeks/{วันจันทร์ของสัปดาห์}
const me = getUser().name;
const $ = function (id) { return document.getElementById(id); };
const TABS = [["overview", "Duty Overview", "layout-dashboard"], ["checklist", "Duty Checklist", "clipboard-check"],
  ["reports", "Cleanliness Reports", "triangle-alert"], ["history", "Duty History", "history"]];
const ISSUE_ST = { submitted: ["Submitted", "gray"], pending: ["Pending Review", "amber"], verified: ["Verified", "blue"], resolved: ["Resolved", "green"] };
const NEXT_ST = { submitted: "pending", pending: "verified", verified: "resolved" };
const DAY_SHORT = ["จ.", "อ.", "พ.", "พฤ.", "ศ."];

let tab = "overview", filter = "all", selDay = null;
let admin = sessionStorage.getItem("dutyAdmin") === "1";
let days = [], issues = [], weeks = [];
const open = new Set();
const iss = { area: "", type: "", detail: "", date: "", time: "" };

// ===== ฟังก์ชันช่วย =====
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function icon(name) { const i = document.createElement("i"); i.setAttribute("data-lucide", name); return i; }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function cycleOf(d) { return dateKey(addDays(d, -((d.getDay() + 6) % 7))); } // วันจันทร์ของสัปดาห์
function parseKey(k) { const p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function fmtDay(k) { return parseKey(k).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" }); }
function dayName(k) { return parseKey(k).toLocaleDateString("th-TH", { weekday: "long" }); } // เช่น "วันจันทร์"
function fmtTs(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}
function badge(label, cls) { return el("span", "dbadge " + cls, label); }
function empty(text) { return el("p", "dempty", text); }
function kv(label, val) {
  const r = el("div", "dkv");
  r.appendChild(el("span", "dkv-l", label));
  const v = el("span", "dkv-v");
  if (typeof val === "string") v.textContent = val; else v.appendChild(val);
  r.appendChild(v);
  return r;
}
function head(ic, title, sub) {
  const h = el("div", "dhead");
  h.appendChild(icon(ic));
  const t = el("div");
  t.appendChild(el("strong", "", title));
  if (sub) t.appendChild(el("span", "", sub));
  h.appendChild(t);
  return h;
}
function progressEl(n, total) {
  const prog = el("div", "dprog"), bar = el("div", "dprog-bar"), fill = el("span");
  fill.style.width = (total ? (n / total) * 100 : 0) + "%";
  bar.appendChild(fill);
  prog.append(el("div", "dprog-t", n + "/" + total + " รายการเสร็จแล้ว"), bar);
  return prog;
}

// ===== รายการงาน + สถานะของแต่ละวัน =====
function tasksFor(key) { return DAY_OVERRIDES[parseKey(key).getDay()] || CHECKLIST; }
function recOf(key) { return days.filter(function (x) { return x.id === key; })[0] || null; }
function dayState(key, tk) {
  const r = recOf(key), tasks = tasksFor(key);
  const n = r && r.checks ? tasks.filter(function (t) { return r.checks[t.id]; }).length : 0;
  const o = { n: n, total: tasks.length };
  if (tasks.length && n === tasks.length) return Object.assign(o, { label: "ครบแล้ว", cls: "green" });
  if (key > tk) return Object.assign(o, { label: "ยังไม่ถึงวัน", cls: "gray" });
  if (n) return Object.assign(o, { label: "ยังไม่ครบ", cls: "amber" });
  return Object.assign(o, { label: key === tk ? "ยังไม่เริ่ม" : "ไม่มีบันทึก", cls: "gray" });
}
function weekKeys(now) { const mon = parseKey(cycleOf(now)); return [0, 1, 2, 3, 4].map(function (k) { return dateKey(addDays(mon, k)); }); }
function pickDay(now, tk) { // ค่าเริ่มต้น = วันนี้ (เสาร์-อาทิตย์ = วันศุกร์)
  const ks = weekKeys(now);
  if (selDay && ks.indexOf(selDay) !== -1) return selDay;
  return ks.indexOf(tk) !== -1 ? tk : ks[4];
}
function lines(r, key) { // รายการงานของบันทึกหนึ่งวัน (ใช้ข้อมูลที่บันทึกไว้ ประวัติจึงไม่เพี้ยนเมื่อแก้ลิสต์ทีหลัง)
  const items = r && Array.isArray(r.items) ? r.items : tasksFor(key).map(function (t) { return { l: t.label, d: false }; });
  return items.map(function (it) { return el("div", "dline " + (it.d ? "okc" : "nok"), (it.d ? "ทำแล้ว · " : "ยังไม่ได้ทำ · ") + it.l); });
}

// ติ๊ก/ยกเลิกงาน (ธุรกรรม: หลายคนติ๊กพร้อมกันก็ไม่ทับกัน)
async function toggle(key, task, val) {
  const ref = doc(db, "dutyDays", key), tasks = tasksFor(key), at = Date.now();
  await runTransaction(db, async function (tx) {
    const s = await tx.get(ref);
    const d = s.exists() ? s.data() : { cycle: cycleOf(parseKey(key)), history: [] };
    const checks = Object.assign({}, d.checks || {});
    checks[task.id] = val;
    const n = tasks.filter(function (t) { return checks[t.id]; }).length;
    tx.set(ref, {
      date: key, cycle: d.cycle, checks: checks,
      items: tasks.map(function (t) { return { l: t.label, d: !!checks[t.id] }; }),
      done: n, total: tasks.length, status: n === tasks.length ? "complete" : n ? "partial" : "none",
      at: at, updatedBy: me,
      history: (d.history || []).concat([{ at: at, by: me, action: (val ? "ทำแล้ว: " : "ยกเลิก: ") + task.label }]).slice(-40)
    });
  });
}

// ===== แถบสัปดาห์ =====
function buildWeek(now, tk, sel, jump) {
  const wrap = el("div", "dweek");
  weekKeys(now).forEach(function (key, k) {
    const st = dayState(key, tk);
    const b = el("button", "dday" + (key === sel ? " on" : "") + (key === tk ? " today" : ""));
    b.append(el("span", "dday-n", DAY_SHORT[k]), el("span", "dday-d", String(parseKey(key).getDate())), el("span", "dday-g", st.n + "/" + st.total));
    if (st.label === "ครบแล้ว") b.appendChild(el("span", "dday-s ok"));
    else if (key < tk && st.n < st.total) b.appendChild(el("span", "dday-s miss"));
    b.addEventListener("click", function () { selDay = key; if (jump) tab = "checklist"; draw(); });
    wrap.appendChild(b);
  });
  return wrap;
}

// ===== 1) Duty Overview =====
function renderOverview(p, now, tk) {
  const ks = weekKeys(now), inWeek = ks.indexOf(tk) !== -1, st = dayState(tk, tk);
  const doneDays = ks.filter(function (k) { return dayState(k, tk).label === "ครบแล้ว"; }).length;
  const pend = issues.filter(function (x) { return x.status === "submitted" || x.status === "pending"; }).length;
  const cards = [
    ["งานวันนี้ที่ทำแล้ว", inWeek ? st.n + "/" + st.total : "–", "clipboard-list"],
    ["วันที่ทำเวรครบ (สัปดาห์นี้)", doneDays + "/5", "circle-check"],
    ["จำนวนรายงานปัญหาความสะอาด", String(issues.length), "triangle-alert"],
    ["รายการที่ยังรอตรวจสอบ", String(pend), "clock"]
  ];
  const grid = el("div", "dgrid");
  cards.forEach(function (c) {
    const s = el("div", "dsum"), ic = el("span", "dsum-ic");
    ic.appendChild(icon(c[2]));
    s.append(ic, el("div", "dsum-n", c[1]), el("div", "dsum-l", c[0]));
    grid.appendChild(s);
  });
  p.appendChild(grid);

  const card = el("div", "dcard");
  card.appendChild(head("calendar-days", "เวรวันนี้", now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })));
  if (!inWeek) card.appendChild(empty("วันนี้ไม่มีเวร (วันหยุดสุดสัปดาห์)"));
  else {
    card.appendChild(kv("สถานะ", badge(st.label, st.cls)));
    card.appendChild(progressEl(st.n, st.total));
    const r = recOf(tk);
    lines(r, tk).forEach(function (l) { card.appendChild(l); });
    const go = el("button", "btn-primary", "ไปที่เช็กลิสต์เวรวันนี้");
    go.addEventListener("click", function () { selDay = tk; tab = "checklist"; draw(); });
    card.appendChild(go);
  }
  p.appendChild(card);

  const wk = el("div", "dcard");
  wk.appendChild(head("calendar-days", "เวรสัปดาห์นี้", "กดวันเพื่อดูรายการงาน"));
  wk.appendChild(buildWeek(now, tk, null, true));
  p.appendChild(wk);

  const ev = [];
  days.forEach(function (d) { (d.history || []).forEach(function (h) { ev.push({ at: h.at, text: dayName(d.date) + " · " + h.action, by: h.by }); }); });
  issues.forEach(function (x) {
    ev.push({ at: x.at, text: "รายงานปัญหา: " + x.area + " · " + x.type, by: x.by });
    (x.history || []).forEach(function (h) { if (h.to === "resolved") ev.push({ at: h.at, text: "แก้ไขปัญหาเรียบร้อย: " + x.area, by: h.by }); });
  });
  ev.sort(function (a, b) { return b.at - a.at; });
  const feed = el("div", "dcard");
  feed.appendChild(head("activity", "กิจกรรมล่าสุด"));
  if (!ev.length) feed.appendChild(empty("ยังไม่มีกิจกรรม เมื่อมีการติ๊กงานเวรหรือแจ้งปัญหา จะแสดงที่นี่"));
  ev.slice(0, 8).forEach(function (e) {
    const row = el("div", "dfeed"), b = el("div");
    b.append(el("div", "dfeed-t", e.text), el("div", "dfeed-m", fmtTs(e.at) + " · " + e.by));
    row.append(el("span", "dfeed-dot"), b);
    feed.appendChild(row);
  });
  p.appendChild(feed);
}

// ===== 2) Duty Checklist: เวรวันนั้นๆ =====
function buildDayHead(sel, tk) {
  const d = parseKey(sel), st = dayState(sel, tk), c = el("div", "dcard dtitle"), t = el("div", "dtitle-t");
  t.append(el("strong", "", "เวร" + dayName(sel)), el("span", "", d.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })));
  c.appendChild(t);
  if (sel === tk) c.appendChild(badge("วันนี้", "blue"));
  c.appendChild(badge(st.label, st.cls));
  return c;
}

function buildDayList(sel, tk) {
  const card = el("div", "dcard"), tasks = tasksFor(sel), r = recOf(sel), st = dayState(sel, tk);
  const editable = sel === tk || admin;
  card.appendChild(head("clipboard-check", "รายการงาน", editable ? "ติ๊กเมื่อทำเสร็จ ทุกคนในห้องเห็นตรงกัน" : sel > tk ? "ยังไม่ถึงวัน ดูรายการล่วงหน้า" : "บันทึกของวันที่ผ่านมา (ดูอย่างเดียว)"));
  card.appendChild(progressEl(st.n, st.total));

  if (editable) {
    tasks.forEach(function (t) {
      const done = !!(r && r.checks && r.checks[t.id]);
      const lab = el("label", "chk" + (done ? " done" : "")), cb = el("input");
      cb.type = "checkbox"; cb.checked = done;
      cb.addEventListener("change", async function () {
        const val = cb.checked;
        cb.disabled = true;
        try {
          await toggle(sel, t, val);
          if (val && sel === tk) awardExp(db, getUser(), "duty", tk + "_" + nameKey(me)); // +EXP วันละครั้งต่อคน
        } catch (e) { console.error(e); alert("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"); draw(); }
      });
      lab.append(cb, el("span", "", t.label));
      card.appendChild(lab);
    });
  } else if (r) {
    lines(r, sel).forEach(function (l) { card.appendChild(l); });
  } else {
    if (sel < tk) card.appendChild(el("p", "dnote", "ไม่มีบันทึกการทำเวรของวันนี้"));
    tasks.forEach(function (t) { const row = el("div", "dtask"); row.appendChild(icon("circle")); row.appendChild(el("span", "", t.label)); card.appendChild(row); });
  }
  if (r && r.at) card.appendChild(el("div", "dfeed-m", "อัปเดตล่าสุด " + fmtTs(r.at)));
  return card;
}

// ===== 3) Cleanliness Reports =====
function selectField(label, opts, key) {
  const wrap = el("label", "dfield");
  wrap.appendChild(el("span", "", label));
  const s = el("select");
  s.appendChild(new Option("เลือก...", ""));
  opts.forEach(function (o) { s.appendChild(new Option(o, o)); });
  s.value = iss[key];
  s.addEventListener("change", function () { iss[key] = s.value; });
  wrap.appendChild(s);
  return wrap;
}

function renderReports(p, now, tk) {
  const form = el("div", "dcard dform");
  form.appendChild(head("triangle-alert", "แจ้งปัญหาความสะอาด", "บันทึกเฉพาะสภาพที่พบ ไม่ระบุหรือกล่าวโทษตัวบุคคล"));
  const d = el("input"), t = el("input");
  d.type = "date"; d.max = tk; d.value = iss.date || tk;
  d.addEventListener("change", function () { iss.date = d.value; });
  t.type = "time"; t.value = iss.time || now.toTimeString().slice(0, 5);
  t.addEventListener("change", function () { iss.time = t.value; });
  const row = el("div", "drow2"), l1 = el("label", "dfield"), l2 = el("label", "dfield");
  l1.append(el("span", "", "วันที่พบปัญหา"), d); l2.append(el("span", "", "เวลาที่พบปัญหา"), t);
  row.append(l1, l2);
  const row2 = el("div", "drow2");
  row2.append(selectField("บริเวณที่พบปัญหา", AREAS, "area"), selectField("ประเภทของปัญหา", TYPES, "type"));
  form.append(row, row2);
  const dl = el("label", "dfield"), ta = el("textarea");
  dl.appendChild(el("span", "", "รายละเอียดเพิ่มเติม"));
  ta.rows = 3; ta.maxLength = 300; ta.value = iss.detail;
  ta.addEventListener("input", function () { iss.detail = ta.value; });
  dl.appendChild(ta); form.appendChild(dl);
  const btn = el("button", "btn-primary", "ส่งรายงานปัญหา");
  btn.addEventListener("click", async function () {
    const date = d.value || tk;
    if (!iss.area || !iss.type) return alert("กรุณาเลือกบริเวณและประเภทของปัญหา");
    if (date > tk) return alert("วันที่พบปัญหาต้องไม่เป็นวันในอนาคต");
    if ((iss.area === "อื่น ๆ" || iss.type === "อื่น ๆ") && iss.detail.trim().length < 5) return alert("กรุณาอธิบายรายละเอียดเมื่อเลือก \"อื่น ๆ\"");
    btn.disabled = true;
    const at = Date.now();
    try {
      await addDoc(collection(db, "dutyIssues"), {
        date: date, time: t.value || "", area: iss.area, type: iss.type, detail: iss.detail.trim(),
        by: me, at: at, cycle: cycleOf(new Date()), status: "submitted",
        history: [{ at: at, by: me, action: "ส่งรายงานปัญหา", to: "submitted" }]
      });
    } catch (e) { console.error(e); alert("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"); btn.disabled = false; return; }
    iss.area = ""; iss.type = ""; iss.detail = ""; iss.date = ""; iss.time = "";
    expToast("ส่งรายงานปัญหาเรียบร้อยแล้ว", "circle-check");
  });
  form.appendChild(btn);
  p.appendChild(form);

  const list = el("div", "dcard");
  list.appendChild(head("list", "รายงานปัญหาทั้งหมด", "รวมรายการที่ยังค้างจากสัปดาห์ก่อน"));
  if (!issues.length) list.appendChild(empty("ยังไม่มีรายงานปัญหา ห้องเรียนเรียบร้อยดี"));
  issues.slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (x) { list.appendChild(issueRow(x)); });
  p.appendChild(list);
}

function issueRow(x) {
  const st = ISSUE_ST[x.status] || ISSUE_ST.submitted, r = el("div", "irec"), top = el("div", "irec-top");
  top.append(el("strong", "", x.area + " · " + x.type), badge(st[0], st[1]));
  r.appendChild(top);
  if (x.detail) r.appendChild(el("div", "irec-d", x.detail));
  r.appendChild(el("div", "dfeed-m", "แจ้งโดย " + x.by + " · " + fmtTs(x.at)));
  if (admin && NEXT_ST[x.status]) {
    const next = NEXT_ST[x.status], b = el("button", "mini", "เปลี่ยนเป็น " + ISSUE_ST[next][0]);
    b.addEventListener("click", async function () {
      if (!confirm("เปลี่ยนสถานะเป็น " + ISSUE_ST[next][0] + " ใช่ไหม?")) return;
      await updateDoc(doc(db, "dutyIssues", x.id), { status: next, history: arrayUnion({ at: Date.now(), by: me + " (ผู้ดูแล)", action: "เปลี่ยนสถานะ", to: next }) });
    });
    r.appendChild(b);
  }
  return r;
}

// ===== 4) Duty History =====
function detailOf(o) {
  const d = o.d, box = el("div", "ddetail");
  if (o.kind === "day") lines(d, d.date).forEach(function (l) { box.appendChild(l); });
  else {
    box.append(kv("วันที่/เวลาที่พบ", fmtDay(d.date) + " " + (d.time || "")), kv("ผู้รายงาน", d.by + " · " + fmtTs(d.at)));
    if (d.detail) box.appendChild(kv("รายละเอียด", d.detail));
  }
  (d.history || []).forEach(function (h) { box.appendChild(el("div", "dfeed-m", fmtTs(h.at) + " · " + h.by + " · " + h.action)); });
  return box;
}

function renderHistory(p) {
  const bar = el("div", "dfilters");
  [["all", "All"], ["day", "Duty Reports"], ["issue", "Cleanliness Issues"]].forEach(function (f) {
    const b = el("button", filter === f[0] ? "on" : "", f[1]);
    b.addEventListener("click", function () { filter = f[0]; draw(); });
    bar.appendChild(b);
  });
  p.appendChild(bar);

  const recs = [];
  days.forEach(function (d) { if (d.checks) recs.push({ kind: "day", key: "d" + d.id, date: d.date, at: d.at, d: d }); });
  issues.forEach(function (x) { recs.push({ kind: "issue", key: "x" + x.id, date: x.date, at: x.at, d: x }); });
  const shown = recs.filter(function (o) { return filter === "all" || o.kind === filter; })
    .sort(function (a, b) { return b.date.localeCompare(a.date) || b.at - a.at; });
  if (!shown.length) p.appendChild(empty("ยังไม่มีบันทึกในหมวดนี้"));

  let last = "", group = null;
  shown.forEach(function (o) {
    if (o.date !== last) { last = o.date; p.appendChild(el("div", "dtl-date", fmtDay(o.date))); group = el("div", "dcard dtl"); p.appendChild(group); }
    const d = o.d, isDay = o.kind === "day";
    const st = isDay ? (d.status === "complete" ? ["ครบแล้ว", "green"] : d.status === "partial" ? ["ยังไม่ครบ", "amber"] : ["ยังไม่เริ่ม", "gray"])
      : (ISSUE_ST[d.status] || ISSUE_ST.submitted);
    const row = el("button", "drec"), mid = el("span", "drec-m");
    row.appendChild(icon(isDay ? "clipboard-check" : "triangle-alert"));
    mid.append(el("strong", "", isDay ? "เวร" + dayName(d.date) + " (" + d.done + "/" + d.total + ")" : d.area + " · " + d.type),
      el("small", "", "อัปเดต " + fmtTs(d.at)));
    row.append(mid, badge(st[0], st[1]));
    row.addEventListener("click", function () { if (open.has(o.key)) open.delete(o.key); else open.add(o.key); draw(); });
    group.appendChild(row);
    if (open.has(o.key)) group.appendChild(detailOf(o));
  });

  const ws = weeks.slice().sort(function (a, b) { return b.weekStart.localeCompare(a.weekStart); }).slice(0, 6);
  if (ws.length) {
    const c = el("div", "dcard");
    c.appendChild(head("archive", "สรุปรายสัปดาห์ที่ผ่านมา", "เก็บเฉพาะตัวเลขสรุป รายละเอียดเก่าถูกล้างตามรอบ"));
    ws.forEach(function (w) {
      c.appendChild(kv(fmtDay(w.weekStart) + " – " + fmtDay(w.weekEnd), "เวรครบ " + w.completeDays + "/5 วัน · ปัญหา " + w.issues + " (แก้แล้ว " + w.resolved + " / ค้าง " + w.unresolved + ")"));
    });
    p.appendChild(c);
  }
}

// ===== วาดหน้า =====
function draw() {
  const now = new Date(), tk = dateKey(now), p = $("dutyPanel");
  p.innerHTML = "";
  $("dutyTabs").querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b.dataset.t === tab); });
  if (tab === "overview") renderOverview(p, now, tk);
  else if (tab === "checklist") {
    const sel = pickDay(now, tk);
    p.append(buildWeek(now, tk, sel, false), buildDayHead(sel, tk), buildDayList(sel, tk));
  } else if (tab === "reports") renderReports(p, now, tk);
  else renderHistory(p);
}
function render() { // เรียกตอนข้อมูลเปลี่ยน: ไม่รบกวนตอนกำลังพิมพ์
  const ae = document.activeElement;
  if ($("dutyPanel").contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== "checkbox") return;
  draw();
}

TABS.forEach(function (t) {
  const b = el("button", "duty-tab");
  b.dataset.t = t[0]; b.setAttribute("role", "tab");
  b.appendChild(icon(t[2])); b.appendChild(el("span", "", t[1]));
  b.addEventListener("click", function () { tab = t[0]; draw(); });
  $("dutyTabs").appendChild(b);
});

function adminBtn() {
  $("adminBtn").classList.toggle("on", admin);
  $("adminBtn").querySelector("span").textContent = admin ? "ผู้ดูแล: เปิดอยู่ (กดเพื่อออก)" : "ผู้ดูแล";
}
$("adminBtn").addEventListener("click", function () {
  if (admin) { admin = false; sessionStorage.removeItem("dutyAdmin"); }
  else {
    const pw = prompt("รหัสผู้ดูแล:");
    if (pw === null) return;
    if (pw !== ADMIN_PASSWORD) return alert("รหัสผู้ดูแลไม่ถูกต้อง");
    admin = true; sessionStorage.setItem("dutyAdmin", "1");
  }
  adminBtn(); draw();
});
adminBtn();

function listen(name, assign) {
  onSnapshot(collection(db, name), function (snap) {
    assign(snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
    $("dutyState").hidden = true;
    render();
  }, function () { $("dutyState").hidden = false; $("dutyState").textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ Firebase"; });
}
listen("dutyDays", function (a) { days = a; });
listen("dutyIssues", function (a) { issues = a; });
listen("dutyWeeks", function (a) { weeks = a; });
draw();

// ===== ปิดรอบสัปดาห์ (ทำวันละครั้งต่อเครื่อง) =====
// รอบเก่า: สร้างสรุป -> ลบบันทึกเวรเก่าและปัญหาที่แก้แล้ว -> เก็บปัญหาที่ยังไม่แก้ไว้จนกว่าจะแก้
async function closeOldCycles() {
  const tk = dateKey();
  if (localStorage.getItem("dutyClosed") === tk) return;
  try {
    const cur = cycleOf(new Date());
    const snaps = await Promise.all(["dutyDays", "dutyIssues"].map(function (n) { return getDocs(query(collection(db, n), where("cycle", "!=", cur))); }));
    const by = {};
    snaps.forEach(function (s, i) {
      s.docs.forEach(function (d) {
        const c = d.data().cycle;
        by[c] = by[c] || { d: [], x: [] };
        by[c][i === 0 ? "d" : "x"].push({ ref: d.ref, data: d.data() });
      });
    });
    for (const c of Object.keys(by)) {
      const g = by[c], mon = parseKey(c);
      const openN = g.x.filter(function (x) { return x.data.status !== "resolved"; }).length;
      await runTransaction(db, async function (tx) {
        const sRef = doc(db, "dutyWeeks", c);
        if ((await tx.get(sRef)).exists()) return;
        tx.set(sRef, {
          weekStart: c, weekEnd: dateKey(addDays(mon, 6)),
          completeDays: g.d.filter(function (x) { return x.data.status === "complete"; }).length,
          partialDays: g.d.filter(function (x) { return x.data.status === "partial"; }).length,
          issues: g.x.length, resolved: g.x.length - openN, unresolved: openN, closedAt: Date.now()
        });
      });
      const del = g.d.concat(g.x.filter(function (x) { return x.data.status === "resolved"; }));
      await Promise.all(del.map(function (x) { return deleteDoc(x.ref); }));
    }
    localStorage.setItem("dutyClosed", tk);
  } catch (e) { console.error("ปิดรอบสัปดาห์ไม่สำเร็จ", e); }
}
closeOldCycles();