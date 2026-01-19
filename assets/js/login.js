import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firebase Configuration
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

function setMsg(t) { 
  if (msgEl) {
    msgEl.textContent = t || "";
    msgEl.className = t ? 'error' : '';
  }
}

function val(el) { 
  return (el?.value || "").trim(); 
}

// LOGIN BUTTON - Only allows existing members to log in
loginBtn?.addEventListener("click", async () => {
  try {
    setMsg("");
    const email = val(emailEl);
    const password = val(passEl);
    
    if (!email || !password) {
      return setMsg("Enter email and password.");
    }
    
    const cred = await signInWithEmailAndPassword(auth, email, password);
    
    // Check if user has paid
    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);
    const paid = snap.exists() && snap.data().paid === true;
    
    sessionStorage.setItem('user-is-logged-in', 'true');
    window.location.replace(paid ? "/members/" : "/members/pricing.html");
    
  } catch (e) {
    setMsg("Invalid email or password.");
  }
});

// SIGNUP BUTTON - Redirects to payment page (NO FREE ACCOUNT CREATION)
signupBtn?.addEventListener("click", () => {
  // Redirect to pricing/payment page
  window.location.href = "/members/pricing.html";
});