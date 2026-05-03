import { useLayoutEffect, useRef, useState } from "react";
import { RippleLogo } from "@/components/RippleLogo";
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

  uniform vec2 uResolution;
  uniform vec2 uMouseUv;
  uniform float uHoverIntensity;
  uniform vec3 uColor;
  uniform float uTime;

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

  float centerDisc(float r) {
    return smoothstep(0.095, 0.09, r);
  }

  float rippleRing(float r, float phase) {
    float rippleR = phase * 0.55;
    float w = 0.006;
    float band = 1.0 - smoothstep(w, w * 1.8, abs(r - rippleR));
    return band * pow(1.0 - phase, 1.4);
  }

  void main() {
    vec2 toMouse = vUv - uMouseUv;
    float d = length(toMouse);
    float force = smoothstep(0.35, 0.0, d) * uHoverIntensity;
    vec2 sampleUv = vUv - normalize(toMouse + vec2(1e-6)) * force * 0.08;

    vec2 p = (sampleUv - 0.5) * 2.0;
    p.x *= uResolution.x / max(uResolution.y, 1.0);
    float r = length(p);

    float n = (valueNoise(p * 6.0 + uTime * 0.15) - 0.5) * 0.012;
    float rN = r + n;

    float brightness = centerDisc(rN);

    float t = uTime * 0.10;
    float ripples = 0.0;
    ripples += rippleRing(rN, fract(t));
    ripples += rippleRing(rN, fract(t + 0.25));
    ripples += rippleRing(rN, fract(t + 0.5));
    ripples += rippleRing(rN, fract(t + 0.75));
    brightness = max(brightness, ripples * 0.75);

    int ix = int(mod(gl_FragCoord.x, 8.0));
    int iy = int(mod(gl_FragCoord.y, 8.0));
    float threshold = (bayer8[iy * 8 + ix] + 0.5) / 64.0;

    float mask = step(threshold, brightness);
    fragColor = vec4(uColor, mask);
  }
`;

export function RippleLogoCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglSupported] = useState(detectWebGL2);

  useLayoutEffect(() => {
    if (!webglSupported) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    // Clear to transparent before the browser's first paint to avoid a
    // white flash from the uninitialized canvas backing store.
    gl.clearColor(0, 0, 0, 0);
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

    const uResolutionLoc = gl.getUniformLocation(program, "uResolution");
    const uMouseUvLoc = gl.getUniformLocation(program, "uMouseUv");
    const uHoverLoc = gl.getUniformLocation(program, "uHoverIntensity");
    const uColorLoc = gl.getUniformLocation(program, "uColor");
    const uTimeLoc = gl.getUniformLocation(program, "uTime");

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

    let mouseX = -1;
    let mouseY = -1;
    let targetMouseX = -1;
    let targetMouseY = -1;
    let hover = 0;
    let targetHover = 0;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseX = (e.clientX - rect.left) / rect.width;
      targetMouseY = 1 - (e.clientY - rect.top) / rect.height;
    };
    const onPointerEnter = () => {
      targetHover = 1;
    };
    const onPointerLeave = () => {
      targetHover = 0;
    };

    if (!reducedMotion) {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerenter", onPointerEnter);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }

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
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    let rafId = 0;
    let firstFrame = true;
    const animate = (now: number) => {
      if (targetMouseX >= 0) {
        mouseX += (targetMouseX - mouseX) * 0.15;
        mouseY += (targetMouseY - mouseY) * 0.15;
      }
      hover += (targetHover - hover) * 0.08;

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uResolutionLoc, bufferW, bufferH);
      gl.uniform2f(uMouseUvLoc, mouseX, mouseY);
      gl.uniform1f(uHoverLoc, hover);
      gl.uniform3f(uColorLoc, colorR, colorG, colorB);
      gl.uniform1f(uTimeLoc, now * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (firstFrame) {
        firstFrame = false;
        canvas.style.visibility = "visible";
        canvas.style.opacity = "1";
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      if (!reducedMotion) {
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerenter", onPointerEnter);
        canvas.removeEventListener("pointerleave", onPointerLeave);
      }
      gl.deleteProgram(program);
      gl.deleteBuffer(positionBuffer);
      gl.deleteVertexArray(vao);
    };
  }, [webglSupported]);

  if (!webglSupported) return <RippleLogo className={className} />;
  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        display: "block",
        visibility: "hidden",
        opacity: 0,
        transition: "opacity 800ms ease",
      }}
    />
  );
}
