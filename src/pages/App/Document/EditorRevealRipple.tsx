import { useLayoutEffect, useRef, useState } from "react";
import {
  compileShader,
  createFullscreenTriangleBuffer,
  detectWebGL2,
  fullscreenTriangleVertexShader,
  linkProgram,
  parseCssColorToRgb,
} from "@/lib/webgl-utils";

// Tunable knobs — change these to taste.
const WAVE_COUNT = 2;                 // number of concentric ripples per click
const WAVE_GAP_SEC = 0.14;            // delay between successive waves
const SINGLE_WAVE_LIFETIME_SEC = 0.9; // how long each individual wave lives
const FADE_OUT_TAIL_SEC = 0.35;       // global fade applied at the very end
const MAX_CONCURRENT_RIPPLES = 8;     // simultaneous click ripples on screen
const OPACITY = 0.8;                  // 0..1 — overall alpha of the effect
const TOTAL_LIFETIME_SEC =
  SINGLE_WAVE_LIFETIME_SEC + (WAVE_COUNT - 1) * WAVE_GAP_SEC + FADE_OUT_TAIL_SEC;

const fragmentShaderSource = /* glsl */ `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec4  uEditorRect;     // (left, top, right, bottom) in device pixels, top-left origin
  uniform vec3  uColor;
  uniform int   uActiveRipples;
  uniform vec2  uRipplePositions[${MAX_CONCURRENT_RIPPLES}]; // device pixels, top-left origin
  uniform float uRippleStarts[${MAX_CONCURRENT_RIPPLES}];    // seconds

  const int   MAX_RIPPLES        = ${MAX_CONCURRENT_RIPPLES};
  const int   WAVE_COUNT         = ${WAVE_COUNT};
  const float WAVE_GAP           = ${WAVE_GAP_SEC};
  const float LIFETIME           = ${SINGLE_WAVE_LIFETIME_SEC};
  const float FADE_OUT_TAIL      = ${FADE_OUT_TAIL_SEC};
  const float OPACITY            = ${OPACITY};
  const float SPEED              = 800.0;   // device px / sec
  const float RING_WIDTH         = 6.0;     // device px
  const float RING_INTENSITY     = 0.2;

  // Collapse-on-collider knobs. The wavefront's geometry warps toward the
  // editor wall as it gets close — \`wallProx = exp(-sdf / COLLAPSE_REACH)\`
  // is the common 0..1 driver — and the ring becomes wider, noisier, and
  // brighter against the wall. None of these terms cause reflection; the
  // wave deforms and intensifies at impact, then dies as the front passes.
  const float COLLAPSE_REACH     = 40.0;    // device px — radius of the wall's influence
  const float COLLAPSE_PULL      = 00.0;    // device px — how much iso-distance contours bend toward the wall
  const float COLLAPSE_CHAOS     = 40.0;    // device px — high-frequency front breakup near the wall
  const float COLLAPSE_WIDEN     = 10.0;     // multiplier on RING_WIDTH at the wall (smear)
  const float COLLAPSE_BRIGHT    = 1.6;     // brightness multiplier at the wall (compression)

  const float bayer8[64] = float[64](
     0.0, 32.0,  8.0, 40.0,  2.0, 34.0, 10.0, 42.0,
    48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    12.0, 44.0,  4.0, 36.0, 14.0, 46.0,  6.0, 38.0,
    60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
     3.0, 35.0, 11.0, 43.0,  1.0, 33.0,  9.0, 41.0,
    51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    15.0, 47.0,  7.0, 39.0, 13.0, 45.0,  5.0, 37.0,
    63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
  );

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Concentric ring brightness as if the wave radiated from \`source\`, deformed
  // by proximity to the editor wall (\`sdf\` is the unsigned distance from this
  // pixel to the rect, 0 at the boundary). The wall's pull bends the iso-d
  // contours inward so the front stretches into the wall, the band swells and
  // gets noisier as coherence breaks down, and the compressed energy reads
  // as a brightness peak right at impact — no reflection, just collapse.
  float ringAt(vec2 px, vec2 source, float age, float seed, float sdf) {
    float dGeo = distance(px, source);
    float wallProx = exp(-sdf / COLLAPSE_REACH);

    // Pull the wavefront toward the wall: pixels near the wall appear closer
    // to the source than they geometrically are, so the ring "leans" inward.
    float dWarp = dGeo - COLLAPSE_PULL * wallProx;

    // Standard low-frequency wobble + extra coarse noise that only kicks in
    // near the wall, simulating the front losing coherence as it crashes.
    float wobble  = (valueNoise(px * 0.012 + uTime * 0.5 + seed) - 0.5) * 6.0;
    float chaos   = (valueNoise(px * 0.04  + uTime * 1.5 + seed) - 0.5) * COLLAPSE_CHAOS * wallProx;
    float dN = dWarp + wobble + chaos;

    // Ring band width swells as the front approaches the wall.
    float bandWidth = RING_WIDTH * (1.0 + wallProx * COLLAPSE_WIDEN);
    float intensity = RING_INTENSITY * (1.0 + wallProx * (COLLAPSE_BRIGHT - 1.0));

    float b = 0.0;
    for (int i = 0; i < WAVE_COUNT; i++) {
      float waveAge = age - float(i) * WAVE_GAP;
      if (waveAge < 0.0 || waveAge > LIFETIME) continue;
      float waveR = waveAge * SPEED;
      float band  = 1.0 - smoothstep(0.0, bandWidth, abs(dN - waveR));
      float fade  = 1.0 - waveAge / LIFETIME;
      b += band * fade;
    }
    return min(b * intensity, 1.0);
  }

  // True if the segment from s to p crosses the AABB's interior. Slab test
  // with safe inverses so axis-aligned segments don't blow up. Used to occlude
  // the direct wave: pixels that sit behind the editor (relative to the click)
  // contribute nothing — without this, the original ring keeps expanding in the
  // math and re-emerges wherever the canvas extends past the editor.
  bool segmentEntersRect(vec2 s, vec2 p, vec4 rect) {
    vec2 d    = p - s;
    vec2 sgn  = mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), d));
    vec2 invD = sgn / max(abs(d), vec2(1e-6));

    vec2 t1 = (rect.xy - s) * invD;
    vec2 t2 = (rect.zw - s) * invD;
    vec2 tMin = min(t1, t2);
    vec2 tMax = max(t1, t2);

    float tEnter = max(tMin.x, tMin.y);
    float tExit  = min(tMax.x, tMax.y);
    return (tEnter < tExit) && (tExit > 1e-3) && (tEnter < 1.0 - 1e-3);
  }

  void main() {
    vec2 px = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

    // Editor SDF: the inside-shadow gate and the per-pixel \`sdf\` driving
    // every collapse term inside ringAt.
    vec2 center  = 0.5 * (uEditorRect.xy + uEditorRect.zw);
    vec2 halfExt = 0.5 * (uEditorRect.zw - uEditorRect.xy);
    vec2 q       = abs(px - center) - halfExt;
    bool insideEditor = (q.x < 0.0 && q.y < 0.0);
    float sdf = length(max(q, vec2(0.0)));

    float totalLife = LIFETIME + float(WAVE_COUNT - 1) * WAVE_GAP + FADE_OUT_TAIL;
    float brightness = 0.0;

    if (!insideEditor) {
      for (int r = 0; r < MAX_RIPPLES; r++) {
        if (r >= uActiveRipples) break;

        float age = uTime - uRippleStarts[r];
        if (age < 0.0 || age > totalLife) continue;
        float lifeFade = 1.0 - smoothstep(totalLife - FADE_OUT_TAIL, totalLife, age);

        vec2  pos  = uRipplePositions[r];
        float seed = float(r) * 13.7;

        // Skip pixels behind the editor so the original wave can't ghost
        // through the rect and reappear on the far side.
        if (segmentEntersRect(pos, px, uEditorRect)) continue;

        brightness += ringAt(px, pos, age, seed, sdf) * lifeFade;
      }
    }

    // Bayer-8 ordered dither for the stippled look (matches RippleLogoCanvas).
    int ix = int(mod(gl_FragCoord.x, 8.0));
    int iy = int(mod(gl_FragCoord.y, 8.0));
    float threshold = (bayer8[iy * 8 + ix] + 0.5) / 64.0;
    float mask = step(threshold, brightness);

    fragColor = vec4(uColor, mask * OPACITY);
  }
`;

interface RippleState {
  x: number;
  y: number;
  startedAt: number;
}

export function EditorRevealRipple({
  targetSelector = ".bn-editor",
  className,
}: {
  targetSelector?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglSupported] = useState(detectWebGL2);

  useLayoutEffect(() => {
    if (!webglSupported) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listenerTarget = canvas.parentElement;
    if (!listenerTarget) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vs = compileShader(gl, gl.VERTEX_SHADER, fullscreenTriangleVertexShader);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vs || !fs) return;
    const program = linkProgram(gl, vs, fs);
    if (!program) return;
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const positionBuffer = createFullscreenTriangleBuffer(gl);
    const positionLoc = gl.getAttribLocation(program, "a_position");
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uResolutionLoc        = gl.getUniformLocation(program, "uResolution");
    const uTimeLoc              = gl.getUniformLocation(program, "uTime");
    const uEditorRectLoc        = gl.getUniformLocation(program, "uEditorRect");
    const uColorLoc             = gl.getUniformLocation(program, "uColor");
    const uActiveRipplesLoc     = gl.getUniformLocation(program, "uActiveRipples");
    const uRipplePositionsLoc   = gl.getUniformLocation(program, "uRipplePositions");
    const uRippleStartsLoc      = gl.getUniformLocation(program, "uRippleStarts");

    const ripplePositionsBuf = new Float32Array(MAX_CONCURRENT_RIPPLES * 2);
    const rippleStartsBuf    = new Float32Array(MAX_CONCURRENT_RIPPLES);

    let colorR = 1;
    let colorG = 1;
    let colorB = 1;
    const readColor = () => {
      const css = getComputedStyle(canvas).color;
      const rgb = parseCssColorToRgb(css);
      if (rgb) {
        colorR = rgb.r;
        colorG = rgb.g;
        colorB = rgb.b;
      }
    };
    readColor();

    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });

    const dpr = Math.min(window.devicePixelRatio, 2);
    let bufferW = 1;
    let bufferH = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      bufferW = Math.max(1, Math.floor(rect.width * dpr));
      bufferH = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== bufferW) canvas.width = bufferW;
      if (canvas.height !== bufferH) canvas.height = bufferH;
      gl.viewport(0, 0, bufferW, bufferH);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    let ripples: RippleState[] = [];
    let rafId = 0;

    const draw = (now: number) => {
      const tSec = now * 0.001;
      ripples = ripples.filter((r) => tSec - r.startedAt < TOTAL_LIFETIME_SEC);
      if (ripples.length === 0) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        rafId = 0;
        return;
      }

      const editorEl = document.querySelector(targetSelector);
      const canvasRect = canvas.getBoundingClientRect();
      let left = -9999;
      let top = -9999;
      let right = -9998;
      let bottom = -9998;
      if (editorEl) {
        const r = editorEl.getBoundingClientRect();
        left   = (r.left   - canvasRect.left) * dpr;
        top    = (r.top    - canvasRect.top)  * dpr;
        right  = (r.right  - canvasRect.left) * dpr;
        bottom = (r.bottom - canvasRect.top)  * dpr;
      }

      for (let i = 0; i < ripples.length; i++) {
        ripplePositionsBuf[i * 2]     = ripples[i].x;
        ripplePositionsBuf[i * 2 + 1] = ripples[i].y;
        rippleStartsBuf[i]            = ripples[i].startedAt;
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uResolutionLoc, bufferW, bufferH);
      gl.uniform1f(uTimeLoc, tSec);
      gl.uniform4f(uEditorRectLoc, left, top, right, bottom);
      gl.uniform3f(uColorLoc, colorR, colorG, colorB);
      gl.uniform1i(uActiveRipplesLoc, ripples.length);
      gl.uniform2fv(uRipplePositionsLoc, ripplePositionsBuf);
      gl.uniform1fv(uRippleStartsLoc, rippleStartsBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      rafId = requestAnimationFrame(draw);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest(targetSelector)) return;
      const canvasRect = canvas.getBoundingClientRect();
      ripples.push({
        x: (e.clientX - canvasRect.left) * dpr,
        y: (e.clientY - canvasRect.top) * dpr,
        startedAt: performance.now() * 0.001,
      });
      if (ripples.length > MAX_CONCURRENT_RIPPLES) ripples.shift();
      if (rafId === 0) rafId = requestAnimationFrame(draw);
    };

    listenerTarget.addEventListener("pointerdown", onPointerDown);

    return () => {
      listenerTarget.removeEventListener("pointerdown", onPointerDown);
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      gl.deleteProgram(program);
      gl.deleteBuffer(positionBuffer);
      gl.deleteVertexArray(vao);
    };
  }, [webglSupported, targetSelector]);

  if (!webglSupported) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}
