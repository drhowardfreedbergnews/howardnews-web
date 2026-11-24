const canvas = document.querySelector('#desk-motion');
const context = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const points = [];
const arcs = [];
const tilt = -.28;
const cosTilt = Math.cos(tilt);
const sinTilt = Math.sin(tilt);

for (let row = 1; row < 44; row++) {
  const latitude = (row / 44 - .5) * Math.PI;
  const radius = Math.cos(latitude);
  const columns = Math.max(5, Math.round(100 * radius));
  for (let column = 0; column < columns; column++) {
    const longitude = (column / columns) * Math.PI * 2;
    const glow = Math.sin(longitude * 3 + latitude * 7) + Math.cos(longitude * 8 - latitude * 5);
    points.push([radius * Math.cos(longitude), Math.sin(latitude), radius * Math.sin(longitude), glow]);
  }
}
for (const [latitude, angle] of [[.17, .22], [-.27, -.35], [.4, -.05]]) {
  const path = [];
  for (let index = 0; index <= 120; index++) {
    const longitude = index / 120 * Math.PI * 2;
    const x = 1.11 * Math.cos(longitude);
    const z = 1.11 * Math.sin(longitude);
    path.push([x, latitude + z * Math.sin(angle), z * Math.cos(angle)]);
  }
  arcs.push(path);
}

let width = 0;
let height = 0;
let request;
let active = true;
function draw(time) {
  const angle = reduced.matches ? .8 : time * .00011;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const centerX = width * .74;
  const centerY = height * .53;
  const scale = Math.min(height * .46, width * .39);
  const project = ([x, y, z]) => {
    const rotatedX = x * cosine - z * sine;
    const depth = x * sine + z * cosine;
    const perspective = 1 / (1.09 - depth * .15);
    return [
      centerX + (rotatedX * cosTilt - y * sinTilt) * scale * perspective,
      centerY + (rotatedX * sinTilt + y * cosTilt) * scale * perspective,
      depth,
    ];
  };
  context.clearRect(0, 0, width, height);
  const halo = context.createRadialGradient(centerX, centerY, 5, centerX, centerY, scale * 1.5);
  halo.addColorStop(0, '#80a9ff40');
  halo.addColorStop(.6, '#3865f231');
  halo.addColorStop(1, '#3865f200');
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);
  for (const path of arcs) {
    context.beginPath();
    for (const [index, point] of path.entries()) {
      const [x, y] = project(point);
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    }
    context.strokeStyle = '#a8d3ff3d';
    context.stroke();
  }
  for (const point of points) {
    const [x, y, depth] = project(point);
    if (depth < -.22) continue;
    const bright = point[3] > 0.38;
    context.fillStyle = bright ? '#d7f8ff' : '#82a9fa';
    context.globalAlpha = (depth + .25) * (bright ? .7 : .24);
    context.beginPath();
    context.arc(x, y, bright ? 1.25 : .75, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function frame(time) {
  draw(time);
  if (active && !reduced.matches) request = requestAnimationFrame(frame);
}
function restart() {
  cancelAnimationFrame(request);
  if (active) request = requestAnimationFrame(frame);
}
if (context) {
  new ResizeObserver(([entry]) => {
    ({ width, height } = entry.contentRect);
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    restart();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
    restart();
  }).observe(canvas);
  reduced.addEventListener('change', restart);
}
