/* Mobile hamburger toggle for the public site nav (.nav > .shell > .links). */
(function () {
  var nav = document.querySelector('.nav');
  if (!nav) return;
  var links = nav.querySelector('.links');
  if (!links) return;
  if (!links.id) links.id = 'site-nav-links';
  var btn = nav.querySelector('.menu-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-toggle';
    btn.innerHTML = '<span class="bars" aria-hidden="true"></span><span>Menu</span>';
    links.parentNode.insertBefore(btn, links);
  }
  btn.setAttribute('aria-controls', links.id);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');

  function setOpen(open) {
    nav.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  btn.addEventListener('click', function () { setOpen(!nav.classList.contains('nav-open')); });
  links.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('nav-open')) { setOpen(false); btn.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('nav-open') && !nav.contains(e.target)) setOpen(false);
  });
  window.addEventListener('resize', function () { if (window.innerWidth > 1100) setOpen(false); });
})();
