import { useEffect, useRef, useState } from "react";
import {
  Color,
  GLSL3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { RippleLogo } from "@/components/RippleLogo";

const vertexShader = /* glsl */ `
#pragma vscode_glsllint_stage : vert
#ifdef GLSLLINT
  in vec3 position;
  in vec2 uv;
  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
#endif
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
#pragma vscode_glsllint_stage : frag
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

    float n = (valueNoise(p * 6.0 + uTime * 0.5) - 0.5) * 0.012;
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

function detectWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    return !!probe.getContext("webgl2");
  } catch {
    return false;
  }
}

function parseCssColorToRgb(
  css: string,
): { r: number; g: number; b: number } | null {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function RippleLogoCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglSupported] = useState(detectWebGL2);

  useEffect(() => {
    if (!webglSupported) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new PlaneGeometry(2, 2);

    const uniforms = {
      uResolution: { value: new Vector2(1, 1) },
      uMouseUv: { value: new Vector2(-1, -1) },
      uHoverIntensity: { value: 0 },
      uColor: { value: new Color(0xffffff) },
      uTime: { value: 0 },
    };

    const readColor = () => {
      const css = getComputedStyle(canvas).color;
      const rgb = parseCssColorToRgb(css);
      if (rgb) uniforms.uColor.value.setRGB(rgb.r, rgb.g, rgb.b);
    };
    readColor();

    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });

    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const targetMouseUv = new Vector2(-1, -1);
    let targetHover = 0;

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseUv.set(
        (e.clientX - rect.left) / rect.width,
        1 - (e.clientY - rect.top) / rect.height,
      );
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

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(w, h);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    let rafId = 0;
    const animate = (now: number) => {
      const m = uniforms.uMouseUv.value;
      if (targetMouseUv.x >= 0) {
        m.x += (targetMouseUv.x - m.x) * 0.15;
        m.y += (targetMouseUv.y - m.y) * 0.15;
      }
      uniforms.uHoverIntensity.value +=
        (targetHover - uniforms.uHoverIntensity.value) * 0.08;
      uniforms.uTime.value = now * 0.001;

      renderer.render(scene, camera);
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
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [webglSupported]);

  if (!webglSupported) return <RippleLogo className={className} />;
  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ display: "block" }}
    />
  );
}
