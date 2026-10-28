import { useEffect, useState } from 'react';

import { isNovember, watchNovemberAppearance } from '@/src/utils/seasonal-appearance';

export function useNovemberAppearance(): boolean {
  const [november, setNovember] = useState(isNovember);
  useEffect(() => watchNovemberAppearance(setNovember), []);
  return november;
}
