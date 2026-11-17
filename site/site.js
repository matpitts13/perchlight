// The site's one motion moment: rail-map stops light row by row when the map scrolls into view.
// Stops are lit by default; this only dims them first when motion is allowed and the map is still off-screen.
(() => {
  const map = document.getElementById('rails');
  if (!map || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (map.getBoundingClientRect().top < innerHeight) return; // already visible: leave it lit
  map.querySelectorAll('tbody tr').forEach((tr, i) => tr.style.setProperty('--row', i));
  map.classList.add('pending');
  const io = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    requestAnimationFrame(() => { map.classList.add('lit'); map.classList.remove('pending'); });
  }, { threshold: 0.25 });
  io.observe(map);
})();
