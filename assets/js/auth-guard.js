import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

const LOGIN_URL = "/members/login.html";
const PRICING_URL = "/members/pricing.html";

// Set window.__REQUIRE_PAID__ = false on pages that require login but not paid (pricing)
const mustBePaid = window.__REQUIRE_PAID__ !== false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Don't loop if already on login
    if (!window.location.pathname.endsWith("/members/login.html")) {
      window.location.replace(LOGIN_URL);
    }
    return;
  }

  if (!mustBePaid) return;

  const snap = await getDoc(doc(db, "users", user.uid));
  const paid = snap.exists() && snap.data().paid === true;

  if (!paid) window.location.replace(PRICING_URL);
});
