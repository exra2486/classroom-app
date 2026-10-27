import {
  db, collection, onSnapshot, setupCommon, saveUser, getUser
} from "./common.js";

// รหัสผ่านห้อง (เปลี่ยนได้ตรงนี้)
const CLASS_PASSWORD = "C137";

const welcome = document.getElementById("welcome");
const home = document.getElementById("home");
const nameInput = document.getElementById("nameInput");
const passInput = document.getElementById("passInput");
const startBtn = document.getElementById("startBtn");

function showHome() {
  const me = getUser();
  document.getElementById("greetName").textContent = me.name;
  welcome.style.display = "none";
  home.style.display = "block";
  setupCommon();

  // นับงานค้างของตัวเอง (realtime)
  onSnapshot(collection(db, "tasks"), function (snap) {
    const n = snap.docs.filter(function (d) {
      return !(d.data().doneBy || []).includes(me.id);
    }).length;
    document.getElementById("hwSummary").textContent =
      n === 0 ? "ไม่มีงานค้าง" : "ค้างอยู่ " + n + " งาน";
  }, function () {
    document.getElementById("hwSummary").textContent = "โหลดจำนวนงานไม่สำเร็จ";
  });
}

// เคยเข้าสำเร็จแล้ว -> ข้ามหน้าใส่ชื่อ ไม่ต้องกรอกซ้ำ
const me = getUser();
if (me.id && me.name) showHome();

startBtn.addEventListener("click", function () {
  const name = nameInput.value.trim();
  if (name === "") return alert("กรุณาใส่ชื่อก่อนนะ");
  if (passInput.value !== CLASS_PASSWORD) {
    passInput.value = "";
    return alert("รหัสผ่านไม่ถูกต้อง");
  }
  saveUser(name); // บันทึกเบื้องหลัง ไม่ต้องรอ
  showHome();
});

[nameInput, passInput].forEach(function (el) {
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter") startBtn.click();
  });
});
