// One optical overlay and one GPU context, shared by the active surface.
// This paints light, shadow and waves; it does not sample or refract the DOM.
// Coordinates passed to move/pulse are normalized, with the origin at top left.
const WAVE_COUNT = 6;
const MAX_PIXELS = 1400000;
export const LIQUID_MATERIAL_SPEC_VERSION = "2026-09-15-lab-align-v1";
export const LIQUID_MOTION = Object.freeze({
  rippleStrength: 0.74,
  trailStrength: 0.10,
  trailDecay: 0.76,
  edgeStrength: 2,
  edgeSizeInfluence: 0.89,
  edgeSpread: 0.17,
  edgeSpeedResponse: 1.5,
});
export const LIQUID_ENERGY_EPSILON = 0.00001;
export function rippleProfile(width, height) {
  const shortEdge = Math.min(width, height);
  const t = Math.max(0, Math.min(1, (shortEdge - 32) / 148));
  const blend = t * t * (3 - 2 * t);
  return Object.freeze({
    amplitude: 0.14 + 0.86 * blend,
    radius: Math.min(10, Math.max(4, shortEdge * 0.12)),
    damping: 0.976 + 0.011 * blend,
    edgeAbsorption: 0.48 - 0.26 * blend,
  });
}

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
  uniform float rippleRadius;
  uniform float edgeRadius;
  uniform float edgeGain;
  uniform vec3 tint;
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
    float edge = exp(min(dist, 0.) / max(edgeRadius, 1.));
    float edgeGlow = exp(min(dist, 0.) / 9.);
    float nearby = exp(-length((p - pointer * size) / (lensSize * 2.3)));
    float edgeLight = (edge * nearby * .36 + edgeGlow * nearby * .055) * edgeGain;

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
      float envelope = alive * waves[i].w;
      float normalizedFront = front / max(rippleRadius, .1);
      float ring = exp(-normalizedFront * normalizedFront);
      float normalizedShadow = (front - rippleRadius * .8) / max(rippleRadius * (10.25 / 7.5), .1);
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
    vec3 glassTint = tint;
    vec3 paperTint = mix(tint, vec3(1., .97, .87), .35);
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
  const waveLastStep = new Float64Array(WAVE_COUNT);
  const waveEnergy = new Float64Array(WAVE_COUNT);
  const waveKind = Array.from({length:WAVE_COUNT}, () => 'ripple');
  const uniforms = {};
  let program = null, buffer = null, maxDimension = 4096;
  let mounted = false, disposed = false, lost = false, frame = 0;
  let width = 1, height = 1, scale = 1, corner = 0, kind = 0, dark = 0;
  let profile = rippleProfile(width, height);
  let pointerX = .5, pointerY = .5, targetX = .5, targetY = .5;
  let edgeRadius = 10, edgeGain = 0, tint = [1, 1, 1];
  let lastMoveX = .5, lastMoveY = .5, lastMoveAt = -Infinity;
  let lastFrame = 0, accumulator = 0, lastInput = -Infinity, waveIndex = 0, activeEnergy = 0;
  let drawCount = 0, mounts = 0, resizes = 0, contextRestores = 0;

  function resetWaves() {
    for (let i = 0; i < WAVE_COUNT; i++) {
      waves.set([.5, .5, 100, 0], i * 4); waveBirth[i] = -Infinity; waveLastStep[i] = -Infinity; waveEnergy[i] = 0; waveKind[i] = 'ripple';
    }
    activeEnergy = 0;
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
      for (const name of ['size', 'pointer', 'velocity', 'light', 'radius', 'rippleRadius', 'edgeRadius', 'edgeGain', 'tint', 'paper', 'dark', 'pixelScale', 'waves']) {
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
  function stop() { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; accumulator = 0; }
  function clear() {
    if (!lost && !disposed) gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function pointerLight(now) { return Math.pow(Math.max(0, 1 - (now - lastInput) / 850), 1.2); }
  function updateEdge(x, y) {
    const now = performance.now();
    const elapsedMs = Number.isFinite(lastMoveAt) ? Math.max(now - lastMoveAt, 1) : Infinity;
    const distance = Math.hypot((x - lastMoveX) * width, (y - lastMoveY) * height);
    const normalizedSpeed = Math.min(1, Number.isFinite(elapsedMs) ? (distance / elapsedMs) / 1.5 : 0);
    const speedScale = 1 + (.55 + normalizedSpeed * .9 - 1) * LIQUID_MOTION.edgeSpeedResponse;
    const sizeScale = 1 + (Math.min(1.75, Math.max(.28, Math.min(width, height) / 320)) - 1) * LIQUID_MOTION.edgeSizeInfluence;
    edgeRadius = Math.min(90, Math.max(10, Math.min(width, height) * LIQUID_MOTION.edgeSpread));
    edgeGain = Math.min(2.5, Math.max(0, LIQUID_MOTION.edgeStrength * sizeScale * speedScale)) / 2.5;
    lastMoveX = x; lastMoveY = y; lastMoveAt = now;
  }
  function stepWaves(now) {
    for (let i = 0; i < WAVE_COUNT; i++) {
      if (waveEnergy[i] <= 0) continue;
      waveEnergy[i] *= waveKind[i] === 'ripple' ? profile.damping : .968;
      waveLastStep[i] = now;
      if (waveEnergy[i] < LIQUID_ENERGY_EPSILON) {
        waveEnergy[i] = 0; waveBirth[i] = -Infinity; waveLastStep[i] = -Infinity; waves[i * 4 + 3] = 0;
      }
    }
  }
  function updateEnergy(now) {
    activeEnergy = pointerLight(now) ** 2;
    for (const energy of waveEnergy) activeEnergy = Math.max(activeEnergy, energy * energy);
    return activeEnergy;
  }
  function draw(now) {
    const dt = lastFrame ? Math.min(.05, Math.max(0, (now - lastFrame) / 1000)) : 1 / 120;
    lastFrame = now;
    accumulator = Math.min(.25, accumulator + dt);
    while (accumulator >= 1 / 120) { stepWaves(now); accumulator -= 1 / 120; }
    const ease = 1 - Math.exp(-dt * 31.25);
    pointerX += (targetX - pointerX) * ease;
    pointerY += (targetY - pointerY) * ease;
    const light = pointerLight(now);
    gl.uniform2f(uniforms.size, width, height);
    gl.uniform2f(uniforms.pointer, pointerX, pointerY);
    gl.uniform2f(uniforms.velocity, (targetX - pointerX) * width / 40, (targetY - pointerY) * height / 40);
    gl.uniform1f(uniforms.light, light);
    gl.uniform1f(uniforms.radius, corner);
    gl.uniform1f(uniforms.rippleRadius, profile.radius);
    gl.uniform1f(uniforms.edgeRadius, edgeRadius);
    gl.uniform1f(uniforms.edgeGain, edgeGain);
    gl.uniform3f(uniforms.tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(uniforms.paper, kind);
    gl.uniform1f(uniforms.dark, dark);
    gl.uniform1f(uniforms.pixelScale, scale);
    // Upload short ages, so mediump shaders stay precise after hours of use.
    for (let i = 0; i < WAVE_COUNT; i++) {
      waves[i * 4 + 2] = waveBirth[i] === -Infinity ? 100 : Math.min(100, (now - waveBirth[i]) / 1000);
      waves[i * 4 + 3] = waveEnergy[i];
    }
    gl.uniform4fv(uniforms.waves, waves);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawCount++;
    updateEnergy(now);
  }
  function tick(now) {
    frame = 0;
    if (!mounted || disposed || lost || document.hidden) return;
    draw(now);
    if (activeEnergy < LIQUID_ENERGY_EPSILON) { clear(); resetWaves(); stop(); return; }
    frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (!mounted || disposed || lost || document.hidden) return;
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function moveTo(x, y) {
    targetX = Math.max(0, Math.min(1, Number.isFinite(x) ? x : .5));
    targetY = Math.max(0, Math.min(1, Number.isFinite(y) ? y : .5));
    lastInput = performance.now();
    updateEdge(targetX, targetY);
  }
  const api = {
    mount(container, rect, options = {}) {
      if (disposed || !container || !rect || !rect.width || !rect.height) return;
      const changedSurface = canvas.parentNode !== container;
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      profile = rippleProfile(width, height);
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
      tint = Array.isArray(options.tint) && options.tint.length === 3 ? options.tint.map(value => Math.max(0, Math.min(1, Number(value)))) : [1, 1, 1];
      edgeRadius = Math.min(90, Math.max(10, Math.min(width, height) * LIQUID_MOTION.edgeSpread));
      edgeGain = 0; lastMoveX = targetX = .5; lastMoveY = pointerY = .5; lastMoveAt = -Infinity;
      if (changedSurface) {
        stop(); resetWaves();
        pointerX = targetX = .5; pointerY = targetY = .5;
        accumulator = 0; lastInput = -Infinity;
        container.append(canvas); mounts++;
      }
      mounted = true;
      activeEnergy = 0;
    },
    move(x, y) { if (disposed || !mounted) return; moveTo(x, y); wake(); },
    pulse(x, y, kind) {
      if (disposed || !mounted) return;
      if (kind !== 'ripple' && kind !== 'trail') throw new TypeError('pulse kind must be ripple or trail');
      moveTo(x, y);
      const index = waveIndex++ % WAVE_COUNT;
      const now = performance.now();
      waveBirth[index] = now; waveLastStep[index] = now; waveKind[index] = kind;
      let energy = (kind === 'ripple' ? LIQUID_MOTION.rippleStrength : LIQUID_MOTION.trailStrength) * profile.amplitude;
      const edgeDistance = Math.min(targetX * width, (1 - targetX) * width, targetY * height, (1 - targetY) * height);
      if (edgeDistance < profile.radius * 3) energy *= 1 - profile.edgeAbsorption;
      waveEnergy[index] = energy;
      waves.set([targetX, targetY, 0,
        energy], index * 4);
      wake();
    },
    unmount() {
      stop(); clear(); mounted = false; resetWaves(); canvas.remove();
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
        mounted, lost, disposed, contextRestores, activeEnergy, edgeRadius, edgeGain, tint:[...tint],
        specVersion:LIQUID_MATERIAL_SPEC_VERSION, energyEpsilon:LIQUID_ENERGY_EPSILON,
        motion:Object.freeze({...LIQUID_MOTION}), profile:Object.freeze({...profile}) };
    }
  };
  function contextLost(event) { event.preventDefault(); lost = true; stop(); }
  function contextRestored() {
    if (disposed) return;
    lost = false;
    try {
      init(); resetWaves(); contextRestores++;
      lastInput = -Infinity;
    } catch {
      // Let the controller's static/CSS surface remain usable after driver failure.
      lost = true; stop(); canvas.remove(); mounted = false;
    }
  }
  function visibility() {
    if (document.hidden) { stop(); clear(); resetWaves(); lastInput = -Infinity; }
  }
  resetWaves();
  try { init(); } catch (error) { gl.getExtension('WEBGL_lose_context')?.loseContext(); throw error; }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', visibility);
  return api;
}
