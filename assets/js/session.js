import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Paste the SAME firebaseConfig you used in login.js/auth-guard.js
const firebaseConfig = {
  apiKey: "AIzaSyCqyyGwpbYfzigj5dYCyXrOC9bFJwNYc_s",
  authDomain: "hrei-members.firebaseapp.com",
  projectId: "hrei-members",
  storageBucket: "hrei-members.firebasestorage.app",
  messagingSenderId: "756905354156",
  appId: "1:756905354156:web:f50a6bc24aec9954bd5009",
  measurementId: "G-SLBVTW55MG"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const elEmail = document.getElementById("acctEmail");
const elStatus = document.getElementById("acctStatus");
const elPaid = document.getElementById("acctPaid");
const logoutBtn = document.getElementById("logoutBtn");

function setText(el, txt) { if (el) el.textContent = txt; }

onAuthStateChanged(auth, async (user) => {
  if (!user) return; // auth-guard handles redirect elsewhere if needed

  setText(elEmail, user.email || "(no email)");
  setText(elStatus, "Signed in");

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const paid = snap.exists() && snap.data().paid === true;
    setText(elPaid, paid ? "Active (Paid)" : "Not Active");
  } catch (e) {
    setText(elPaid, "Status unavailable");
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/members/login.html";
  });
}
