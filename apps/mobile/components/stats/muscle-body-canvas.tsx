import { useEffect, useRef } from 'react';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { StyleSheet } from 'react-native';
import { createMuscleWireframeRenderer, type MuscleWireframeRenderer, type WireframeFrame } from './muscle-wireframe-renderer';

/** Native depth-tested drawing; the parent owns gestures, selection and accessible controls. */
export function MuscleBodyCanvas({ frame, onError }: { readonly frame: WireframeFrame; readonly onError: () => void }) {
  const renderer = useRef<MuscleWireframeRenderer | null>(null);
  const latest = useRef(frame);
  const mounted = useRef(true);
  const scheduled = useRef<number | null>(null);

  const draw = () => {
    scheduled.current = null;
    try { renderer.current?.draw(latest.current); }
    catch { renderer.current?.dispose(); renderer.current = null; if (mounted.current) onError(); }
  };
  const schedule = () => { if (scheduled.current === null) scheduled.current = requestAnimationFrame(draw); };
  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    if (!mounted.current) return;
    try {
      renderer.current?.dispose(); renderer.current = createMuscleWireframeRenderer(gl); schedule();
    } catch { renderer.current = null; if (mounted.current) onError(); }
  };
  useEffect(() => { latest.current = frame; schedule(); });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
      scheduled.current = null;
      renderer.current?.dispose(); renderer.current = null;
    };
  }, []);

  return (
    <GLView accessible={false} msaaSamples={4} onContextCreate={onContextCreate}
      pointerEvents="none" style={styles.canvas} testID={`stats-muscle-body-${frame.overlay === 'wireframe' ? 'wireframe' : 'patches'}`} />
  );
}

const styles = StyleSheet.create({ canvas: { flex: 1, alignSelf: 'stretch' } });
