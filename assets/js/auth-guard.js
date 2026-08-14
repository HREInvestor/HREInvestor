(async () => {
  const redirect = (message) => window.location.replace("/login.html?message=" + encodeURIComponent(message));
  if (!window.supabase) return redirect("Member login is loading. Please try again.");
  const client = window.supabase.createClient(
    "https://lmivqwscebdupfxxwfcc.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsImV4cCI6MjA4NDE0MDU3MH0.AzE-j9Rrz1HRoGNaqicMJ8jEwO1tVuCqbf9E9J3vuv4"
  );
  const { data: { user } } = await client.auth.getUser();
  if (!user) return redirect("Please sign in to continue.");
  const { data: profile } = await client.from("member_profiles").select("id,email,role,subscription_status").eq("id", user.id).single();
  if (!profile) return redirect("Your member profile is not ready. Please sign in again in a moment.");
  const contractor = profile.role === "owner" || (profile.role === "contractor" && profile.subscription_status === "active");
  if (window.__MEMBER_ROUTE__ === "contractor" && !contractor) return redirect("An active Contractor membership is required.");
  if (window.__MEMBER_ROUTE__ === "owner" && profile.role !== "owner") return redirect("Owner access is required.");
  window.currentMember = { user, profile, contractor, client };
  window.dispatchEvent(new CustomEvent("hrei:member-ready", { detail: window.currentMember }));
})();