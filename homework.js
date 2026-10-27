import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion,
  setupCommon, getUser
} from "./common.js";

if (!setupCommon()) throw new Error("no user");
const me = getUser();

// ===== element =====
const $ = function (id) { return document.getElementById(id); };
const addBtn = $("addBtn"), modal = $("modal"), taskForm = $("taskForm");
const taskList = $("taskList"), emptyMsg = $("emptyMsg");
const archiveModal = $("archiveModal"), archiveList = $("archiveList");
const archiveEmpty = $("archiveEmpty"), archiveCount = $("archiveCount");
const confirmModal = $("confirmModal");
const sortBtn = $("sortBtn");
if (sortBtn) sortBtn.remove(); // เรียงตามเวลาส่งอัตโนมัติแล้ว ไม่ต้องมีปุ่ม

let tasks = [];

// ===== ฟังก์ชันช่วย =====
function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}
function formatDate(s) { const p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

// ===== ตั้งเวลาเปลี่ยนสีกรอบตรงนี้ (หน่วย: ชั่วโมง) =====
const SOON_HOURS = 72;   // เหลือไม่เกิน 3 วัน -> เหลือง
const URGENT_HOURS = 24; // เหลือไม่เกิน 1 วัน -> แดง

function getStatus(t) {
  const h = (new Date(t.dueDate + "T" + t.dueTime) - new Date()) / 36e5;
  if (h < 0) return "overdue";            // เกินกำหนด -> แดงเข้ม
  if (h <= URGENT_HOURS) return "urgent"; // อีกนิดเดียว -> แดง
  if (h <= SOON_HOURS) return "soon";     // ใกล้ถึงกำหนด -> เหลือง
  return "normal";                        // ปกติ -> ฟ้า
}
const labels = { overdue: "เกินกำหนด", urgent: "ด่วน", soon: "ใกล้ถึงกำหนด", normal: "" };

// งานเสร็จแล้ว = เสร็จสำหรับทั้งห้อง (รองรับข้อมูลเก่าที่เคยเก็บเป็น doneBy ด้วย)
function isDone(t) { return t.done === true || (Array.isArray(t.doneBy) && t.doneBy.length > 0); }

// ===== ฟังก์ชันสร้างปุ่มลบ (เฉพาะเจ้าของงาน) =====
function makeDelBtn(t) {
  const b = document.createElement("button");
  b.className = "del-btn";
  b.innerHTML = '<i data-lucide="trash-2"></i>';
  b.addEventListener("click", function () {
    askConfirm("ลบงานนี้ของทุกคนใช่ไหม?", t.title, "ลบเลย", function () {
      deleteDoc(doc(db, "tasks", t.id));
    });
  });
  return b;
}

// ===== แสดงรายการ =====
function render() {
  taskList.innerHTML = "";
  archiveList.innerHTML = "";

  const byDue = function (a, b) {
    return (a.dueDate + a.dueTime).localeCompare(b.dueDate + b.dueTime);
  };
  const active = tasks.filter(function (t) { return !isDone(t); }).sort(byDue);
  const done = tasks.filter(isDone).sort(byDue);

  emptyMsg.style.display = active.length ? "none" : "block";
  archiveEmpty.style.display = done.length ? "none" : "block";
  archiveCount.textContent = done.length;

  active.forEach(function (t) {
    const li = document.createElement("li");
    const st = getStatus(t);
    li.className = "task-card status-" + st;

    const row = document.createElement("div");
    row.className = "task-row";

    const check = document.createElement("button");
    check.className = "check-btn";
    check.innerHTML = '<i data-lucide="check"></i>';
    check.addEventListener("click", function () {
      askConfirm("ทำงานนี้เสร็จแล้วหรือยัง?", t.title, "เสร็จแล้ว", function () {
        updateDoc(doc(db, "tasks", t.id), { done: true, doneByName: me.name });
      });
    });

    const body = document.createElement("div");
    body.className = "task-body";
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = t.title;
    if (labels[st]) {
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.textContent = labels[st];
      title.appendChild(badge);
    }
    const due = document.createElement("div");
    due.className = "task-due";
    due.textContent = "ส่ง " + formatDate(t.dueDate) + " เวลา " + t.dueTime;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = "สั่งเมื่อ " + formatDate(t.assignedDate) + " · เพิ่มโดย " + t.addedBy;
    body.append(title, due, meta);

    if (t.description) {
      const desc = document.createElement("div");
      desc.className = "task-desc";
      desc.textContent = t.description;
      body.appendChild(desc);
      body.classList.add("clickable");
      body.addEventListener("click", function () { li.classList.toggle("open"); });
    }

    row.append(check, body);
    row.appendChild(makeDelBtn(t)); // ทุกคนลบได้
    li.appendChild(row);
    taskList.appendChild(li);
  });

  done.forEach(function (t) {
    const li = document.createElement("li");
    li.className = "archive-item";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "archive-name";
    name.textContent = t.title;
    const by = document.createElement("div");
    by.className = "task-meta";
    by.textContent = "เพิ่มโดย " + t.addedBy + " · ส่ง " + formatDate(t.dueDate) +
      (t.doneByName ? " · เสร็จโดย " + t.doneByName : "");
    info.append(name, by);
    li.appendChild(info);
    // ปุ่มย้อนกลับ (เผื่อกดเสร็จผิด) + ปุ่มลบ ทุกคนใช้ได้
    const acts = document.createElement("div");
    acts.style.display = "flex";
    acts.style.gap = "4px";
    const undo = document.createElement("button");
    undo.className = "del-btn";
    undo.title = "ย้อนกลับเป็นยังไม่เสร็จ";
    undo.style.color = "var(--brand)";
    undo.innerHTML = '<i data-lucide="rotate-ccw"></i>';
    undo.addEventListener("click", function () {
      updateDoc(doc(db, "tasks", t.id), { done: false, doneBy: [], doneByName: "" });
    });
    acts.append(undo, makeDelBtn(t));
    li.appendChild(acts);
    archiveList.appendChild(li);
  });
}

// ===== ดึงข้อมูล realtime + อัปเดตสีทุกนาที =====
onSnapshot(collection(db, "tasks"), function (snap) {
  tasks = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
  render();
}, function () {
  emptyMsg.textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบ Firebase config";
  emptyMsg.style.display = "block";
});
setInterval(render, 60000);

// ===== เพิ่มงาน =====
addBtn.addEventListener("click", function () {
  taskForm.reset();
  $("assignedDate").value = todayString();
  $("dueDate").min = todayString();
  modal.classList.remove("hidden");
});
$("assignedDate").addEventListener("change", function () {
  $("dueDate").min = this.value;
});
$("cancelBtn").addEventListener("click", function () { modal.classList.add("hidden"); });
modal.addEventListener("click", function (e) { if (e.target === modal) modal.classList.add("hidden"); });

taskForm.addEventListener("submit", async function (e) {
  e.preventDefault();
  const title = $("taskTitle").value.trim();
  const assignedDate = $("assignedDate").value;
  const dueDate = $("dueDate").value;
  if (!title) return alert("กรุณาใส่ชื่องานก่อนนะ");
  if (dueDate < assignedDate) return alert("วันส่งต้องไม่ก่อนวันที่สั่งนะ");

  await addDoc(collection(db, "tasks"), {
    title: title,
    assignedDate: assignedDate,
    dueDate: dueDate,
    dueTime: $("dueTime").value,
    description: $("taskDesc").value.trim(),
    addedBy: me.name,
    ownerId: me.id,
    doneBy: []
  });
  modal.classList.add("hidden");
});

// ===== หน้าต่างยืนยัน =====
let confirmAction = null;
function askConfirm(title, text, okLabel, onYes) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmOk").textContent = okLabel;
  confirmAction = onYes;
  confirmModal.classList.remove("hidden");
}
function closeConfirm() { confirmModal.classList.add("hidden"); confirmAction = null; }
$("confirmCancel").addEventListener("click", closeConfirm);
$("confirmOk").addEventListener("click", function () {
  if (confirmAction) confirmAction();
  closeConfirm();
});

// ===== กล่องงานที่เสร็จแล้ว =====
$("archiveBtn").addEventListener("click", function () { archiveModal.classList.remove("hidden"); });
$("archiveClose").addEventListener("click", function () { archiveModal.classList.add("hidden"); });
archiveModal.addEventListener("click", function (e) {
  if (e.target === archiveModal) archiveModal.classList.add("hidden");
});
