import { useEffect, useRef, useState } from "react";

export function useAudioLevel(stream: MediaStream | null) {
  const [audioLevel, setAudioLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      // Reset via microtask to avoid synchronous setState in effect body
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setAudioLevel(0);
      });
      return () => {
        cancelled = true;
      };
    }

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const sample = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length / 255;
      setAudioLevel(avg);
      rafRef.current = requestAnimationFrame(sample);
    };

    rafRef.current = requestAnimationFrame(sample);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      void audioCtx.close();
    };
  }, [stream]);

  return audioLevel;
}
