import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * True while the component is mounted. A group write that finishes after the
 * user already left its screen (Back during a slow save) must not navigate:
 * `router.back()` would then pop the screen the user returned to.
 */
export function useMountedRef(): MutableRefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
