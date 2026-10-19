// Prediction Bot owner guard (standalone; does not touch CRM files)
window.BB = (function () {
  const sb = supabase.createClient('https://lmivqwscebdupfxxwfcc.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaXZxd3NjZWJkdXBmeHh3ZmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NjQ1NzAsImV4cCI6MjA4NDE0MDU3MH0.AzE-j9Rrz1HRoGNaqicMJ8jEwO1tVuCqbf9E9J3vuv4');
  return {
    sb,
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
    signOut: () => sb.auth.signOut(),
    summary: () => sb.rpc('bettingbot_owner_summary'),
    revshare: () => sb.rpc('bettingbot_revshare_summary'),
    markPaid: (display_name, amount, paid_on, note) => sb.rpc('bettingbot_revshare_mark_paid', { p_display_name: display_name, p_amount: amount, p_paid_on: paid_on || null, p_note: note || null }),
    voidPayment: (id) => sb.rpc('bettingbot_revshare_void', { p_id: id }),
  };
})();
