import { useLayoutEffect, useRef, useState } from "react";
import {
  compileShader,
  createFullscreenTriangleBuffer,
  detectWebGL2,
  fullscreenTriangleVertexShader,
  linkProgram,
  parseCssColorToRgb,
} from "@/lib/webgl-utils";

const fragmentShaderSource = /* glsl */ `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec4  uEditorRect;     // (left, top, right, bottom) in device pixels, top-left origin
  uniform vec2  uRipplePos;      // device pixels, top-left origin
  uniform float uRippleStart;    // seconds
  uniform vec3  uColor;

  const float SPEED      = 1800.0;  // device px / sec
  const float LIFETIME   = 0.9;     // seconds
  const float RING_WIDTH = 14.0;    // device px
  const float EDGE_BAND  = 4.0;     // device px (~2px CSS at dpr=2)
  const float FLASH_DUR  = 0.35;    // seconds

  void main() {
    vec2 px = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

    float age = uTime - uRippleStart;
    if (age < 0.0 || age > LIFETIME) { fragColor = vec4(0.0); return; }

    float lifeFade  = 1.0 - smoothstep(LIFETIME * 0.6, LIFETIME, age);
    float wavefront = age * SPEED;
    float d         = distance(px, uRipplePos);

    float ring = (1.0 - smoothstep(0.0, RING_WIDTH, abs(d - wavefront))) * 0.35 * lifeFade;

    vec2  center  = 0.5 * (uEditorRect.xy + uEditorRect.zw);
    vec2  halfExt = 0.5 * (uEditorRect.zw - uEditorRect.xy);
    vec2  q       = abs(px - center) - halfExt;
    float outside = length(max(q, vec2(0.0)));
    float inside  = min(max(q.x, q.y), 0.0);
    float perim   = abs(outside + inside);
    float edgeMask = 1.0 - smoothstep(0.0, EDGE_BAND, perim);

    float impactAge = age - d / SPEED;
    float edgeFlash = edgeMask
      * smoothstep(0.0, 0.04, impactAge)
      * (1.0 - smoothstep(0.0, FLASH_DUR, impactAge));

    float brightness = max(ring, edgeFlash * 1.2) * lifeFade;
    fragColor = vec4(uColor, brightness);
  }
`;

interface RippleState {
  x: number;
  y: number;
  startedAt: number;
}

const LIFETIME_SEC = 0.9;

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

    const uResolutionLoc  = gl.getUniformLocation(program, "uResolution");
    const uTimeLoc        = gl.getUniformLocation(program, "uTime");
    const uEditorRectLoc  = gl.getUniformLocation(program, "uEditorRect");
    const uRipplePosLoc   = gl.getUniformLocation(program, "uRipplePos");
    const uRippleStartLoc = gl.getUniformLocation(program, "uRippleStart");
    const uColorLoc       = gl.getUniformLocation(program, "uColor");

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

    let ripple: RippleState | null = null;
    let rafId = 0;

    const draw = (now: number) => {
      const tSec = now * 0.001;
      if (!ripple) {
        rafId = 0;
        return;
      }
      const age = tSec - ripple.startedAt;
      if (age > LIFETIME_SEC) {
        ripple = null;
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

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uResolutionLoc, bufferW, bufferH);
      gl.uniform1f(uTimeLoc, tSec);
      gl.uniform4f(uEditorRectLoc, left, top, right, bottom);
      gl.uniform2f(uRipplePosLoc, ripple.x, ripple.y);
      gl.uniform1f(uRippleStartLoc, ripple.startedAt);
      gl.uniform3f(uColorLoc, colorR, colorG, colorB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      rafId = requestAnimationFrame(draw);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest(targetSelector)) return;
      const canvasRect = canvas.getBoundingClientRect();
      ripple = {
        x: (e.clientX - canvasRect.left) * dpr,
        y: (e.clientY - canvasRect.top) * dpr,
        startedAt: performance.now() * 0.001,
      };
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
