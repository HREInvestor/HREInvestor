import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const createBtn = document.getElementById("createBtn");
const confirmForm = document.getElementById("confirmForm");

function setMsg(text, type = 'error') {
  if (msgEl) {
    msgEl.textContent = text || "";
    msgEl.className = text ? type : '';
  }
}

function val(el) {
  return (el?.value || "").trim();
}

// Check if user came from payment (you can add URL params here later)
// For now, we'll allow account creation on this page
// In production, you'd verify a payment token from Clover

confirmForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  try {
    setMsg("Creating your account...", 'info');
    createBtn.disabled = true;
    
    const email = val(emailEl);
    const password = val(passEl);
    
    if (!email || !password) {
      setMsg("Please enter both email and password.", 'error');
      createBtn.disabled = false;
      return;
    }
    
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.", 'error');
      createBtn.disabled = false;
      return;
    }
    
    // Create Firebase Authentication account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user data in Firestore with paid status
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      paid: true,
      createdAt: new Date().toISOString(),
      membershipType: "standard" // You can customize this based on payment tier
    });
    
    setMsg("✅ Account created successfully! Redirecting...", 'success');
    
    // Set session and redirect to members area
    sessionStorage.setItem('user-is-logged-in', 'true');
    
    setTimeout(() => {
      window.location.href = '/members/';
    }, 1500);
    
  } catch (error) {
    console.error("Account creation error:", error);
    
    let errorMsg = "Failed to create account. ";
    
    if (error.code === 'auth/email-already-in-use') {
      errorMsg = "This email is already registered. Please log in instead.";
    } else if (error.code === 'auth/invalid-email') {
      errorMsg = "Invalid email address.";
    } else if (error.code === 'auth/weak-password') {
      errorMsg = "Password is too weak. Use at least 6 characters.";
    } else {
      errorMsg += error.message;
    }
    
    setMsg(errorMsg, 'error');
    createBtn.disabled = false;
  }
});