import {
  db, collection, doc, addDoc, deleteDoc, onSnapshot, setupCommon, getUser
} from "./common.js";

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

    li.append(title, text, meta);

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
  await addDoc(collection(db, "notes"), {
    subject: subject,
    date: $("noteDate").value,
    period: Number($("period").value),
    text: $("noteText").value.trim(),
    authorName: me.name,
    ownerId: me.id
  });
  modal.classList.add("hidden");
});
