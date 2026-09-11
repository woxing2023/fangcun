// One optical overlay and one GPU context, shared by the active surface.
// This paints light, shadow and waves; it does not sample or refract the DOM.
// Coordinates passed to move/pulse are normalized, with the origin at top left.
const WAVE_COUNT = 6;
const WAVE_LIFETIME = 1000;
const MAX_PIXELS = 1400000;

const vertexSource = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = position * .5 + .5;
    gl_Position = vec4(position, 0., 1.);
  }
`;
const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 uv;
  uniform vec2 size;
  uniform vec2 pointer;
  uniform vec2 velocity;
  uniform float light;
  uniform float radius;
  uniform float paper;
  uniform float dark;
  uniform float pixelScale;
  uniform vec4 waves[6];

  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
  }
  void main() {
    vec2 p = vec2(uv.x, 1. - uv.y) * size;
    float dist = roundedBox(p - size * .5, size * .5, radius);
    float mask = 1. - smoothstep(-1. / pixelScale, 0., dist);
    if (mask < .002) discard;

    float lensSize = clamp(min(size.x, size.y) * .62, 34., 102.);
    vec2 local = (p - pointer * size) / lensSize;
    local -= velocity * .055;
    float core = exp(-dot(local, local) * 1.6);
    float halo = exp(-dot(local, local) * .38);
    // Offset rings form a lit crescent and its softer opposite edge.
    float arcDistance = length(local + vec2(.10, .20)) - .77;
    float crescent = exp(-arcDistance * arcDistance * 125.)
      * smoothstep(-.45, .75, -local.y - local.x * .34);
    float shadeDistance = length(local - vec2(.08, .16)) - .79;
    float crescentShade = exp(-shadeDistance * shadeDistance * 65.)
      * smoothstep(-.30, .85, local.y + local.x * .3);
    float edge = exp(min(dist, 0.) / 2.2);
    float edgeGlow = exp(min(dist, 0.) / 9.);
    float nearby = exp(-length((p - pointer * size) / (lensSize * 2.3)));
    float edgeLight = edge * nearby * .36 + edgeGlow * nearby * .055;

    float waveLight = 0.;
    float waveShade = 0.;
    float paperBloom = 0.;
    for (int i = 0; i < 6; i++) {
      // Uniform branches skip expired waves for every pixel on the surface.
      if (waves[i].w <= 0. || waves[i].z >= 1.) continue;
      float age = min(waves[i].z, 1.);
      float alive = step(0., age) * (1. - smoothstep(.62, 1., age));
      float d = length((p - waves[i].xy * size) / 256.) * 256.;
      float front = d - age * (130. + lensSize * 1.8);
      float envelope = exp(-age * 2.2) * alive * waves[i].w;
      float normalizedFront = front / 7.5;
      float ring = exp(-normalizedFront * normalizedFront);
      float normalizedShadow = (front - 6.) / 10.25;
      float shadowRing = exp(-normalizedShadow * normalizedShadow);
      waveLight += ring * envelope;
      waveShade += shadowRing * envelope;
      float bloomSize = 26. + max(age, 0.) * 110.;
      float bloomDistance = d / bloomSize;
      paperBloom += exp(-bloomDistance * bloomDistance) * envelope;
    }

    float glassHighlight = core * .085 + halo * .027 + crescent * .28;
    float highlight = mix(glassHighlight, core * .14 + halo * .025, paper) * light;
    highlight += edgeLight * light * mix(1., .40, paper);
    highlight += mix(waveLight * .34, paperBloom * .14, paper);
    float shadow = crescentShade * .075 * light * (1. - paper);
    shadow += waveShade * .14 * (1. - paper);
    float opacity = clamp(highlight + shadow, 0., .48) * mask;
    vec3 ink = mix(vec3(.15, .30, .37), vec3(.03, .10, .16), dark);
    vec3 glassTint = mix(vec3(.87, .98, 1.), vec3(.55, .89, 1.), dark);
    vec3 paperTint = mix(vec3(1., .97, .87), vec3(.85, .83, .68), dark);
    vec3 tint = mix(glassTint, paperTint, paper);
    vec3 color = mix(ink, tint, highlight / max(highlight + shadow, .0001));
    gl_FragColor = vec4(color, opacity);
  }
`;

export function createRenderer() {
  const canvas = document.createElement('canvas');
  const attributes = { alpha:true, antialias:false, depth:false, stencil:false,
    premultipliedAlpha:false, preserveDrawingBuffer:false, powerPreference:'default' };
  // WebGL 1 is sufficient for one analytic shader and also covers older WebViews.
  const gl = canvas.getContext('webgl', attributes) || canvas.getContext('experimental-webgl', attributes);
  if (!gl) throw new Error('WebGL unavailable');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.materialRenderer = 'shared-webgl';
  const waves = new Float32Array(WAVE_COUNT * 4);
  const waveBirth = new Float64Array(WAVE_COUNT);
  const uniforms = {};
  let program = null, buffer = null, maxDimension = 4096;
  let mounted = false, disposed = false, lost = false, frame = 0;
  let width = 1, height = 1, scale = 1, corner = 0, kind = 0, dark = 0;
  let pointerX = .5, pointerY = .5, targetX = .5, targetY = .5;
  let lastFrame = 0, lastInput = -Infinity, deadline = 0, waveIndex = 0;
  let drawCount = 0, mounts = 0, resizes = 0, contextRestores = 0;

  function resetWaves() {
    for (let i = 0; i < WAVE_COUNT; i++) {
      waves.set([.5, .5, 100, 0], i * 4); waveBirth[i] = -Infinity;
    }
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Material shader: ${message}`);
    }
    return shader;
  }
  function init() {
    let vertex, fragment, nextProgram;
    try {
      vertex = compile(gl.VERTEX_SHADER, vertexSource);
      fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      nextProgram = gl.createProgram();
      gl.attachShader(nextProgram, vertex); gl.attachShader(nextProgram, fragment);
      gl.linkProgram(nextProgram);
      if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) throw new Error(`Material program: ${gl.getProgramInfoLog(nextProgram)}`);
      program = nextProgram;
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // One oversized triangle avoids the quad's shared diagonal and extra work.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (const name of ['size', 'pointer', 'velocity', 'light', 'radius', 'paper', 'dark', 'pixelScale', 'waves']) {
        uniforms[name] = gl.getUniformLocation(program, name === 'waves' ? 'waves[0]' : name);
      }
      maxDimension = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.viewport(0, 0, canvas.width, canvas.height);
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      if (nextProgram) gl.deleteProgram(nextProgram);
      program = null; buffer = null;
      throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; }
  function clear() {
    if (!lost && !disposed) gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function draw(now) {
    const dt = lastFrame ? Math.min(48, now - lastFrame) : 16;
    lastFrame = now;
    const ease = 1 - Math.exp(-dt / 32);
    pointerX += (targetX - pointerX) * ease;
    pointerY += (targetY - pointerY) * ease;
    const light = Math.pow(Math.max(0, 1 - (now - lastInput) / 850), 1.2);
    gl.uniform2f(uniforms.size, width, height);
    gl.uniform2f(uniforms.pointer, pointerX, pointerY);
    gl.uniform2f(uniforms.velocity, (targetX - pointerX) * width / 40, (targetY - pointerY) * height / 40);
    gl.uniform1f(uniforms.light, light);
    gl.uniform1f(uniforms.radius, corner);
    gl.uniform1f(uniforms.paper, kind);
    gl.uniform1f(uniforms.dark, dark);
    gl.uniform1f(uniforms.pixelScale, scale);
    // Upload short ages, so mediump shaders stay precise after hours of use.
    for (let i = 0; i < WAVE_COUNT; i++) waves[i * 4 + 2] = Math.min(100, (now - waveBirth[i]) / 1000);
    gl.uniform4fv(uniforms.waves, waves);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawCount++;
  }
  function tick(now) {
    frame = 0;
    if (!mounted || disposed || lost || document.hidden) return;
    if (now >= deadline) { clear(); lastFrame = 0; return; }
    draw(now);
    frame = requestAnimationFrame(tick);
  }
  function wake(duration) {
    if (!mounted || disposed || lost || document.hidden) return;
    const now = performance.now();
    deadline = Math.max(deadline, now + duration);
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function moveTo(x, y) {
    targetX = Math.max(0, Math.min(1, Number.isFinite(x) ? x : .5));
    targetY = Math.max(0, Math.min(1, Number.isFinite(y) ? y : .5));
    lastInput = performance.now();
  }
  const api = {
    mount(container, rect, options = {}) {
      if (disposed || !container || !rect || !rect.width || !rect.height) return;
      const changedSurface = canvas.parentNode !== container;
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      scale = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / (width * height)), maxDimension / width, maxDimension / height);
      const pixelsWide = Math.max(1, Math.floor(width * scale));
      const pixelsHigh = Math.max(1, Math.floor(height * scale));
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
        canvas.width = pixelsWide; canvas.height = pixelsHigh;
        if (!lost) gl.viewport(0, 0, pixelsWide, pixelsHigh);
        resizes++;
      }
      corner = Math.max(0, Math.min(Number.isFinite(options.radius) ? options.radius : 18, width * .5, height * .5));
      kind = options.kind === 'paper' ? 1 : 0;
      dark = options.dark === true || (options.dark == null && document.documentElement.dataset.mode === 'dark') ? 1 : 0;
      if (changedSurface) {
        stop(); resetWaves();
        pointerX = targetX = .5; pointerY = targetY = .5;
        deadline = 0; lastInput = performance.now();
        container.append(canvas); mounts++;
      }
      mounted = true;
      wake(850);
    },
    move(x, y) { if (disposed || !mounted) return; moveTo(x, y); wake(850); },
    pulse(x, y, strength = 1) {
      if (disposed || !mounted) return;
      moveTo(x, y);
      const index = waveIndex++ % WAVE_COUNT;
      waveBirth[index] = performance.now();
      waves.set([targetX, targetY, 0,
        Math.max(0, Math.min(1.5, Number.isFinite(strength) ? strength : 1))], index * 4);
      wake(WAVE_LIFETIME);
    },
    unmount() {
      stop(); clear(); mounted = false; deadline = 0; resetWaves(); canvas.remove();
    },
    dispose() {
      if (disposed) return;
      api.unmount(); disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      if (!lost) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      buffer = null; program = null;
    },
    getStats() {
      return { drawCount, mounts, resizes, pixelCount:canvas.width * canvas.height,
        pixelRatio:Math.round(scale * 100) / 100, running:frame !== 0,
        mounted, lost, disposed, contextRestores };
    }
  };
  function contextLost(event) { event.preventDefault(); lost = true; stop(); }
  function contextRestored() {
    if (disposed) return;
    lost = false;
    try {
      init(); resetWaves(); contextRestores++;
      lastInput = performance.now(); deadline = 0; wake(850);
    } catch {
      // Let the controller's static/CSS surface remain usable after driver failure.
      lost = true; stop(); canvas.remove(); mounted = false;
    }
  }
  function visibility() {
    if (document.hidden) { stop(); clear(); resetWaves(); deadline = 0; lastInput = -Infinity; }
  }
  resetWaves();
  try { init(); } catch (error) { gl.getExtension('WEBGL_lose_context')?.loseContext(); throw error; }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', visibility);
  return api;
}
