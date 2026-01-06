import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "REPLACE",
  authDomain: "REPLACE",
  projectId: "REPLACE",
  storageBucket: "REPLACE",
  messagingSenderId: "REPLACE",
  appId: "REPLACE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = document.getElementById("email");
const password = document.getElementById("password");
const msg = document.getElementById("msg");

document.getElementById("signupBtn").addEventListener("click", async () => {
  msg.textContent = "";
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    await setDoc(doc(db, "users", cred.user.uid), { paid: false, createdAt: Date.now() }, { merge: true });
    window.location.href = "/members/pricing.html";
  } catch (e) {
    msg.textContent = e.message;
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  msg.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    window.location.href = "/members/dashboard.html";
  } catch (e) {
    msg.textContent = e.message;
  }
});
