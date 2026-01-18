import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqyyGwpbYfzigj5dYCyXrOC9bFJwNYc_s",
  authDomain: "hrei-members.firebaseapp.com",
  projectId: "hrei-members",
  storageBucket: "hrei-members.firebasestorage.app",
  messagingSenderId: "756905354156",
  appId: "1:756905354156:web:f50a6bc24aec9954bd5009",
  measurementId: "G-SLBVTW55MG"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const msgEl = document.getElementById("msg");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");

function setMsg(t) { if (msgEl) msgEl.textContent = t || ""; }
function val(el) { return (el?.value || "").trim(); }

async function routeAfterLogin(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const paid = snap.exists() && snap.data().paid === true;
 window.location.replace(paid ? "/members/" : "/members/pricing.html");
}

loginBtn?.addEventListener("click", async () => {
  try {
    setMsg("");
    const email = val(emailEl);
    const password = val(passEl);
    if (!email || !password) return setMsg("Enter email and password.");
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await routeAfterLogin(cred.user.uid);
  } catch (e) {
    setMsg(e?.message || "Login failed.");
  }
});

signupBtn?.addEventListener("click", async () => {
  try {
    setMsg("");
    const email = val(emailEl);
    const password = val(passEl);
    if (!email || !password) return setMsg("Enter email and password.");
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Create user doc if it doesn't exist
    const ref = doc(db, "users", cred.user.uid);
    await setDoc(ref, { paid: false, email }, { merge: true });

    window.location.replace("/members/pricing.html");
  } catch (e) {
    setMsg(e?.message || "Signup failed.");
  }
});
