import { WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, ShaderMaterial, Mesh, Vector2, Vector4 } from './three.module.min.js';

// One shared GPU context, attached only to the currently interactive material.
// Adapter interface: mount(container, rect), move(x,y), pulse(x,y), unmount(), dispose().
export function createRenderer() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha:true, antialias:false, powerPreference:'low-power' });
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new WebGLRenderer({ canvas, context, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0, 0);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new Scene();
  const camera = new OrthographicCamera(-1,1,1,-1,0,1);
  const geometry = new PlaneGeometry(2,2);
  const uniforms = {
    time:{ value:0 }, size:{ value:new Vector2(1,1) }, pointer:{ value:new Vector2(.5,.5) },
    waves:{ value:Array.from({ length:8 }, () => new Vector4(.5,.5,-100,0)) }
  };
  const material = new ShaderMaterial({
    transparent:true, depthTest:false, depthWrite:false, uniforms,
    vertexShader:'varying vec2 uvPos; void main(){ uvPos=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader:`
      varying vec2 uvPos;
      uniform float time;
      uniform vec2 size;
      uniform vec2 pointer;
      uniform vec4 waves[8];
      void main(){
        vec2 aspect = size / max(size.x,size.y);
        float water = 0.;
        for(int i=0;i<8;i++){
          float age = time-waves[i].z;
          float d = length((uvPos-waves[i].xy)*aspect);
          float front = d-age*.48;
          float envelope = exp(-front*front*650.)*exp(-age*2.8)*step(0.,age);
          water += sin(front*105.)*envelope*waves[i].w;
        }
        float glow = exp(-length((uvPos-pointer)*aspect)*8.);
        float rim = pow(1.-min(min(uvPos.x,1.-uvPos.x),min(uvPos.y,1.-uvPos.y)),30.);
        vec3 tint = mix(vec3(.50,.70,.76),vec3(.94,.99,1.),smoothstep(-.5,.5,water));
        gl_FragColor = vec4(tint, clamp(abs(water)*.24+glow*.035+rim*.04,0.,.32));
      }`
  });
  scene.add(new Mesh(geometry,material));
  let mounted = false, deadline = 0, index = 0, lost = false, disposed = false;
  function tick() {
    if (!mounted || lost || disposed || performance.now() > deadline) { renderer.setAnimationLoop(null); return; }
    uniforms.time.value = performance.now()/1000;
    renderer.render(scene,camera);
  }
  function wake() { if (lost || disposed) return; deadline = performance.now()+1200; renderer.setAnimationLoop(tick); }
  const api = {
    mount(container, rect) {
      if (lost || disposed) return;
      renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);
      uniforms.size.value.set(rect.width,rect.height);
      uniforms.waves.value.forEach(w => w.z=-100);
      container.append(canvas); mounted=true; wake();
    },
    move(x,y) { uniforms.pointer.value.set(x,1-y); wake(); },
    pulse(x,y,strength=1) {
      uniforms.waves.value[index++ % 8].set(x,1-y,performance.now()/1000,strength); wake();
    },
    unmount() { mounted=false; renderer.setAnimationLoop(null); canvas.remove(); },
    dispose() {
      if (disposed) return;
      api.unmount(); disposed=true; geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    }
  };
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost=true; api.unmount(); });
  return api;
}
