// ===== ระบบนับผู้เข้าใช้ (นับ "บัญชี" ไม่ใช่ "จำนวนครั้ง") =====
// โครงข้อมูลใน Firestore
//   visitors/2026-11-02_<แฮชชื่อ>  -> ตัวกันนับซ้ำ (มีเอกสาร = บัญชีนี้ถูกนับแล้ววันนี้)
//   stats/2026-11                  -> { days: { "01": 14, "02": 17, ... } } สรุปรายเดือน (กราฟอ่านแค่นี้)
import { doc, runTransaction, increment, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function pad(n) { return String(n).padStart(2, "0"); }

export function dateKey(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
export function monthKey(d) { return dateKey(d).slice(0, 7); }

// แปลงชื่อเป็นรหัสสั้นๆ (ไม่เก็บชื่อจริงในฐานข้อมูล)
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function nameKey(name) { return hash(String(name).trim().toLowerCase()); }

// ===== อัลกอริทึมนับ: เรียกทุกครั้งที่เปิดหน้า แต่เขียนข้อมูลแค่ครั้งแรกของวัน =====
export async function trackVisit(db, name) {
  try {
    const today = dateKey();
    const who = nameKey(name);
    const mark = today + "|" + who;
    if (localStorage.getItem("lastCounted") === mark) return; // เครื่องนี้นับแล้ว จบเลย

    const visitRef = doc(db, "visitors", today + "_" + who);
    const statRef = doc(db, "stats", today.slice(0, 7));

    await runTransaction(db, async function (tx) {
      const v = await tx.get(visitRef);
      if (v.exists()) return; // บัญชีนี้ถูกนับแล้ววันนี้ (เช่น จากอีกเครื่อง)
      tx.set(visitRef, { at: Date.now() });
      const patch = { days: {} };
      patch.days[today.slice(8)] = increment(1);
      tx.set(statRef, patch, { merge: true });
    });
    localStorage.setItem("lastCounted", mark);
  } catch (e) {
    console.error("นับผู้เข้าใช้ไม่สำเร็จ (หน้าเว็บยังใช้งานได้ปกติ)", e);
  }
}

// ฟังสรุปรายเดือนแบบ realtime: cb(days) หรือ cb(null) ถ้าอ่านไม่ได้ คืนฟังก์ชันยกเลิก
export function watchMonth(db, key, cb) {
  return onSnapshot(doc(db, "stats", key), function (snap) {
    cb(snap.exists() ? (snap.data().days || {}) : {});
  }, function () { cb(null); });
}

// สไตล์ป้าย "วันนี้ (N คน)" ในเมนูข้าง (ฉีดให้เอง ไม่ต้องแก้ style.css)
const css = ".member-head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
  ".today-pill{padding:2px 10px;font-size:.75rem;font-weight:600;color:var(--brand);background:var(--brand-soft);" +
  "border-radius:999px;text-decoration:none;white-space:nowrap;transition:background .15s}" +
  ".today-pill:hover{background:#d9eafa}";
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);
