import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://lmivqwscebdupfxxwfcc.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaXZxd3NjZWJkdXBmeHh3ZmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NjQ1NzAsImV4cCI6MjA4NDE0MDU3MH0.AzE-j9Rrz1HRoGNaqicMJ8jEwO1tVuCqbf9E9J3vuv4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getMemberContext() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { user: null, profile: null };

  const { data: profile, error: profileError } = await supabase
    .from("member_profiles")
    .select("id, email, role, subscription_status")
    .eq("id", user.id)
    .single();

  if (profileError) return { user, profile: null };
  return { user, profile };
}
