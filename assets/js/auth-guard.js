(async () => {
  const redirect = (message) => window.location.replace("/login.html?message=" + encodeURIComponent(message));
  if (!window.supabase) return redirect("Member login is loading. Please try again.");
  const client = window.supabase.createClient(
    "https://lmivqwscebdupfxxwfcc.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaXZxd3NjZWJkdXBmeHh3ZmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NjQ1NzAsImV4cCI6MjA4NDE0MDU3MH0.AzE-j9Rrz1HRoGNaqicMJ8jEwO1tVuCqbf9E9J3vuv4"
  );
  const { data: { user } } = await client.auth.getUser();
  if (!user) return redirect("Please sign in to continue.");
  const { data: profile } = await client.from("member_profiles").select("id,email,role,access_status").eq("id", user.id).single();
  if (!profile) return redirect("Your member profile is not ready. Please sign in again in a moment.");
  if (profile.access_status !== "approved") {
    await client.auth.signOut();
    return redirect(profile.access_status === "suspended" ? "Your account has been paused. Contact HREI for help." : "Your account is awaiting Owner approval.");
  }
  const contractor = profile.role === "owner" || profile.role === "contractor";
  if (window.__MEMBER_ROUTE__ === "contractor" && !contractor) return redirect("Contractor access has not been approved for this account.");
  if (window.__MEMBER_ROUTE__ === "owner" && profile.role !== "owner") return redirect("Owner access is required.");
  window.currentMember = { user, profile, contractor, client };
  window.dispatchEvent(new CustomEvent("hrei:member-ready", { detail: window.currentMember }));
})();