import {
  db, collection, doc, addDoc, deleteDoc, onSnapshot, setupCommon, getUser
} from "./common.js";

import { awardExp, expToast } from "./exp.js";

if (!setupCommon()) throw new Error("no user");
const me = getUser();

const $ = function (id) { return document.getElementById(id); };
const list = $("noteList"), emptyMsg = $("emptyMsg"), modal = $("modal");
let notes = [];

function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}
function formatDate(s) { const p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

function render() {
  list.innerHTML = "";
  emptyMsg.style.display = notes.length ? "none" : "block";

  // วันที่ล่าสุดก่อน ถ้าวันเดียวกันให้คาบหลังขึ้นก่อน
  const sorted = notes.slice().sort(function (a, b) {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.period - a.period;
  });

  sorted.forEach(function (n) {
    const li = document.createElement("li");
    li.className = "post-card";

    const title = document.createElement("div");
    title.className = "post-title";
    title.textContent = n.subject;
    const chip = document.createElement("span");
    chip.className = "period-chip";
    chip.textContent = "คาบ " + n.period;
    title.appendChild(chip);

    const text = document.createElement("div");
    text.className = "post-text";
    text.textContent = n.text;

    const meta = document.createElement("div");
    meta.className = "post-meta";
    meta.textContent = formatDate(n.date) + " · บันทึกโดย " + n.authorName;

    li.append(title, text);
    appendFiles(li, n);
    li.appendChild(meta);

    { // ทุกคนลบได้
      const actions = document.createElement("div");
      actions.className = "post-actions";
      const del = document.createElement("button");
      del.className = "mini-btn";
      del.innerHTML = '<i data-lucide="trash-2"></i>ลบ';
      del.addEventListener("click", function () {
        if (confirm("ลบบันทึกนี้ใช่ไหม?")) deleteDoc(doc(db, "notes", n.id));
      });
      actions.appendChild(del);
      li.appendChild(actions);
    }
    list.appendChild(li);
  });
}

// ลิงก์ต้องเป็น https:// เท่านั้น (กันลิงก์อันตราย เช่น javascript:)
function isHttps(u) {
  try { return new URL(u).protocol === "https:"; } catch (e) { return false; }
}

// อ่านลิงก์ที่แนบจากฟอร์ม (คืน null ถ้ามีลิงก์ไม่ถูกต้อง)
function readFiles() {
  const out = [];
  const rows = document.querySelectorAll(".file-row");
  for (let i = 0; i < rows.length; i++) {
    const url = rows[i].querySelector(".file-url").value.trim();
    if (!url) continue;
    if (!isHttps(url)) { alert("ลิงก์ไฟล์ที่ " + (i + 1) + " ไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://)"); return null; }
    out.push({ name: rows[i].querySelector(".file-name").value.trim() || "ไฟล์แนบ", url: url });
  }
  return out;
}

// วาดปุ่มเปิดไฟล์ในการ์ด (ตรวจ https ซ้ำตอนแสดงผล)
function appendFiles(li, n) {
  if (!Array.isArray(n.files)) return;
  const box = document.createElement("div");
  box.className = "file-list";
  n.files.forEach(function (f) {
    if (!f || !isHttps(f.url)) return;
    const a = document.createElement("a");
    a.className = "file-btn";
    a.href = f.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = '<i data-lucide="file-text"></i>';
    const name = document.createElement("span");
    name.textContent = f.name || "ไฟล์แนบ";
    a.appendChild(name);
    a.insertAdjacentHTML("beforeend", '<i data-lucide="external-link" class="file-ext"></i>');
    box.appendChild(a);
  });
  if (box.children.length) li.appendChild(box);
}

onSnapshot(collection(db, "notes"), function (snap) {
  notes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
  render();
}, function () {
  emptyMsg.textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบ Firebase config";
  emptyMsg.style.display = "block";
});

// ===== เพิ่มบันทึก =====
$("addBtn").addEventListener("click", function () {
  $("noteForm").reset();
  $("noteDate").value = todayString();
  modal.classList.remove("hidden");
});
$("cancelBtn").addEventListener("click", function () { modal.classList.add("hidden"); });
modal.addEventListener("click", function (e) { if (e.target === modal) modal.classList.add("hidden"); });

$("noteForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const subject = $("subject").value.trim();
  if (!subject) return alert("กรุณาใส่ชื่อวิชาก่อนนะ");
  const files = readFiles();
  if (files === null) return;
  // ไม่ให้ EXP ถ้าคำอธิบายสั้นไป (<10 ตัวอักษร) หรือซ้ำ (วิชา+วันที่+คาบ)
  const dateV = $("noteDate").value, per = Number($("period").value), txt = $("noteText").value.trim();
  const dup = notes.some(function (n) { return n.date === dateV && n.period === per && String(n.subject).trim().toLowerCase() === subject.toLowerCase(); });
  const ref = await addDoc(collection(db, "notes"), {
    subject: subject,
    date: $("noteDate").value,
    period: Number($("period").value),
    text: $("noteText").value.trim(),
    authorName: me.name,
    ownerId: me.id,
    files: files
  });
  modal.classList.add("hidden");
  if (dup || txt.length < 10) expToast("ไม่ผ่านเงื่อนไข (คำอธิบายสั้นเกินไปหรือซ้ำ) จึงไม่ได้รับ EXP", "info");
  else awardExp(db, me, "note", ref.id);
});