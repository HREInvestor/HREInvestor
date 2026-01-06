import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

const LOGIN_URL = "/members/login.html";
const PRICING_URL = "/members/pricing.html";

// Set window.__REQUIRE_PAID__ = false on pages that only require login (like pricing)
const mustBePaid = window.__REQUIRE_PAID__ !== false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace(LOGIN_URL);
    return;
  }
  if (!mustBePaid) return;

  const snap = await getDoc(doc(db, "users", user.uid));
  const paid = snap.exists() && snap.data().paid === true;

  if (!paid) window.location.replace(PRICING_URL);
});
