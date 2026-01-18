// Simple session check without ES6 imports
(function() {
  console.log('Auth guard checking session...');
  
  const isLoggedIn = sessionStorage.getItem('user-is-logged-in');
  
  if (!isLoggedIn) {
    console.log('No session found, redirecting to login');
    window.location.href = '/login.html';
  } else {
    console.log('Session valid, allowing access');
  }
})();