import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion,
  setupCommon, getUser
} from "./common.js";
import { arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

if (!setupCommon()) throw new Error("no user");
const me = getUser();

const $ = function (id) { return document.getElementById(id); };
const list = $("postList"), emptyMsg = $("emptyMsg"), modal = $("modal");
let posts = [];
const openIds = new Set(); // ประกาศที่กางคอมเมนต์อยู่

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " +
    d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function btn(text, cls, fn) {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = text; // ใช้กับข้อความที่เราเขียนเองเท่านั้น
  b.addEventListener("click", fn);
  return b;
}

function render() {
  list.innerHTML = "";
  emptyMsg.style.display = posts.length ? "none" : "block";

  // ปักหมุดขึ้นก่อน แล้วเรียงใหม่สุดก่อน
  const sorted = posts.slice().sort(function (a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  sorted.forEach(function (p) {
    const li = document.createElement("li");
    li.className = "post-card" + (p.pinned ? " pinned" : "");

    const title = document.createElement("div");
    title.className = "post-title";
    title.textContent = p.title;
    if (p.pinned) {
      const tag = document.createElement("span");
      tag.className = "pin-tag";
      tag.innerHTML = '<i data-lucide="pin"></i>ปักหมุด';
      title.appendChild(tag);
    }

    const text = document.createElement("div");
    text.className = "post-text";
    text.textContent = p.text;

    const meta = document.createElement("div");
    meta.className = "post-meta";
    meta.textContent = "โดย " + p.authorName + " · " + fmt(p.createdAt);

    const comments = p.comments || [];
    const actions = document.createElement("div");
    actions.className = "post-actions";
    actions.appendChild(btn('<i data-lucide="message-square"></i>ตอบกลับ (' + comments.length + ')', "mini-btn", function () {
      if (openIds.has(p.id)) openIds.delete(p.id); else openIds.add(p.id);
      render();
    }));
    { // ทุกคนปักหมุด/ลบได้
      actions.appendChild(btn(p.pinned ? '<i data-lucide="pin-off"></i>เลิกปักหมุด' : '<i data-lucide="pin"></i>ปักหมุด', "mini-btn", function () {
        updateDoc(doc(db, "announcements", p.id), { pinned: !p.pinned });
      }));
      actions.appendChild(btn('<i data-lucide="trash-2"></i>ลบ', "mini-btn", function () {
        if (confirm("ลบประกาศนี้ใช่ไหม?")) deleteDoc(doc(db, "announcements", p.id));
      }));
    }

    li.append(title, text, meta, actions);
    if (openIds.has(p.id)) li.appendChild(buildComments(p, comments));
    list.appendChild(li);
  });
}

function buildComments(p, comments) {
  const box = document.createElement("div");
  box.className = "comments";

  comments.forEach(function (c) {
    const row = document.createElement("div");
    row.className = "comment";
    const left = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = c.name;
    const msg = document.createElement("span");
    msg.textContent = c.text;
    const time = document.createElement("small");
    time.textContent = fmt(c.at);
    left.append(name, msg, time);
    row.appendChild(left);
    { // ทุกคนลบคอมเมนต์ได้
      row.appendChild(btn('<i data-lucide="x"></i>', "mini-btn", function () {
        updateDoc(doc(db, "announcements", p.id), { comments: arrayRemove(c) });
      }));
    }
    box.appendChild(row);
  });

  const form = document.createElement("div");
  form.className = "comment-form";
  const input = document.createElement("input");
  input.placeholder = "เขียนตอบกลับ...";
  const send = btn("ส่ง", "btn-primary", function () {
    const t = input.value.trim();
    if (!t) return;
    updateDoc(doc(db, "announcements", p.id), {
      comments: arrayUnion({
        id: crypto.randomUUID(), ownerId: me.id, name: me.name, text: t, at: Date.now()
      })
    });
  });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send.click(); });
  form.append(input, send);
  box.appendChild(form);
  return box;
}

onSnapshot(collection(db, "announcements"), function (snap) {
  posts = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
  render();
}, function () {
  emptyMsg.textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบ Firebase config";
  emptyMsg.style.display = "block";
});

// ===== เพิ่มประกาศ =====
$("addBtn").addEventListener("click", function () {
  $("postForm").reset();
  modal.classList.remove("hidden");
});
$("cancelBtn").addEventListener("click", function () { modal.classList.add("hidden"); });
modal.addEventListener("click", function (e) { if (e.target === modal) modal.classList.add("hidden"); });

$("postForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const title = $("postTitle").value.trim();
  if (!title) return alert("กรุณาใส่หัวข้อก่อนนะ");
  await addDoc(collection(db, "announcements"), {
    title: title,
    text: $("postText").value.trim(),
    authorName: me.name,
    ownerId: me.id,
    pinned: false,
    createdAt: Date.now(),
    comments: []
  });
  modal.classList.add("hidden");
});
