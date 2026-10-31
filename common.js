import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ===== ฐานข้อมูล (หน้าอื่นเรียกใช้ผ่าน import) =====
export const db = getFirestore(initializeApp(firebaseConfig));
export { collection, doc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion };

// ===== ผู้ใช้: userId สุ่มครั้งแรก + ชื่อเล่น เก็บในเครื่องตัวเอง =====
export function getUser() {
  return {
    id: localStorage.getItem("userId"),
    name: localStorage.getItem("nickname")
  };
}

export function saveUser(name) {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("userId", id);
  }
  localStorage.setItem("nickname", name);
  // ส่งลงฐานข้อมูลเบื้องหลัง ไม่ให้หน้าเว็บค้างถ้าเน็ตช้า/ยังไม่ตั้งค่า Firebase
  return setDoc(doc(db, "members", id), { name: name }, { merge: true })
    .catch(function (e) { console.error("บันทึกชื่อลง Firebase ไม่สำเร็จ", e); });
}

// ===== เรียกทุกหน้า (ยกเว้นหน้าใส่ชื่อ) =====
export function setupCommon() {
  const user = getUser();

  // ไม่มีชื่อ -> กลับหน้าแรก
  if (!user.id || !user.name) {
    location.href = "index.html";
    return false;
  }

  const chip = document.getElementById("userName");
  if (chip) chip.textContent = user.name;

  buildSidebar(user);
  return true;
}

// ===== แปลง <i data-lucide> เป็นไอคอนอัตโนมัติ (รวมถึงที่สร้างด้วย JS ทีหลัง) =====
let iconTimer;
function drawIcons() {
  if (window.lucide && document.querySelector("i[data-lucide]")) window.lucide.createIcons();
}
new MutationObserver(function () { clearTimeout(iconTimer); iconTimer = setTimeout(drawIcons, 0); })
  .observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("load", drawIcons);

// ===== เมนูข้าง =====
function buildSidebar(user) {
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay hidden";

  const side = document.createElement("aside");
  side.className = "sidebar";

  const head = document.createElement("div");
  head.className = "sidebar-head";
  const h = document.createElement("h2");
  h.textContent = "Class";
  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-btn";
  closeBtn.innerHTML = '<i data-lucide="x"></i>';
  head.append(h, closeBtn);

  const nav = document.createElement("nav");
  nav.className = "sidebar-nav";
  [["index.html", "หน้าแรก", "house"], ["homework.html", "การบ้าน", "clipboard-list"],
   ["announcements.html", "ประกาศ", "megaphone"], ["notes.html", "สิ่งที่เรียน", "notebook-pen"],
   ["timetable.html", "ตารางเรียน", "calendar-days"]
  ].forEach(function (item) {
    const a = document.createElement("a");
    a.href = item[0];
    a.innerHTML = '<i data-lucide="' + item[2] + '"></i><span></span>';
    a.querySelector("span").textContent = item[1];
    if (location.pathname.endsWith(item[0])) a.classList.add("current");
    nav.appendChild(a);
  });

  const title = document.createElement("h3");
  title.textContent = "สมาชิก";
  const list = document.createElement("ul");
  list.className = "member-list";

  const settings = document.createElement("button");
  settings.className = "settings-btn";
  settings.innerHTML = '<i data-lucide="settings"></i>ตั้งค่า / เปลี่ยนชื่อ';

  const logout = document.createElement("button");
  logout.className = "settings-btn logout-btn";
  logout.innerHTML = '<i data-lucide="log-out"></i>ออกจากระบบ';

  side.append(head, nav, title, list, settings, logout);
  overlay.appendChild(side);
  document.body.appendChild(overlay);

  // รายชื่อสมาชิกแบบ realtime
  onSnapshot(collection(db, "members"), function (snap) {
    list.innerHTML = "";
    title.textContent = "สมาชิก (" + snap.size + " คน)";
    snap.docs
      .map(function (d) { return d.data().name; })
      .sort(function (a, b) { return a.localeCompare(b, "th"); })
      .forEach(function (name) {
        const li = document.createElement("li");
        const av = document.createElement("span");
        av.className = "avatar";
        av.textContent = name.charAt(0).toUpperCase();
        const nm = document.createElement("span");
        nm.textContent = name;
        li.append(av, nm);
        list.appendChild(li);
      });
  });

  document.getElementById("menuBtn").addEventListener("click", function () {
    overlay.classList.remove("hidden");
  });
  closeBtn.addEventListener("click", function () { overlay.classList.add("hidden"); });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.classList.add("hidden");
  });

  // ออกจากระบบ: ลบชื่อออกจากรายชื่อห้อง + ล้าง userId/ชื่อในเครื่อง (เริ่มใหม่หมด)
  logout.addEventListener("click", async function () {
    if (!confirm("ออกจากระบบใช่ไหม?")) return;
    const id = localStorage.getItem("userId");
    try {
      if (id) {
        await Promise.race([
          deleteDoc(doc(db, "members", id)),
          new Promise(function (r) { setTimeout(r, 3000); })
        ]);
      }
    } catch (e) { console.error(e); }
    localStorage.removeItem("userId");
    localStorage.removeItem("nickname");
    location.href = "index.html";
  });

  settings.addEventListener("click", async function () {
    const n = prompt("ชื่อเล่นใหม่:", user.name);
    if (n && n.trim() !== "") {
      await Promise.race([
        saveUser(n.trim()),
        new Promise(function (r) { setTimeout(r, 3000); })
      ]);
      location.reload();
    }
  });
}
