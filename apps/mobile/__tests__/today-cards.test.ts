/** Today's cards layout: which page a swipe settles on (`TodayCards`). */

import { pageAtOffset } from '@/components/today';

describe('pageAtOffset', () => {
  it('rounds the offset to the nearest card step', () => {
    expect(pageAtOffset(0, 353, 2)).toBe(0);
    expect(pageAtOffset(170, 353, 2)).toBe(0);
    expect(pageAtOffset(180, 353, 2)).toBe(1);
    expect(pageAtOffset(353, 353, 2)).toBe(1);
  });

  it('keeps an overscroll on the first or last page', () => {
    expect(pageAtOffset(-40, 353, 2)).toBe(0);
    expect(pageAtOffset(900, 353, 2)).toBe(1);
  });

  it('stays on the first page before the pager is measured', () => {
    expect(pageAtOffset(353, 0, 2)).toBe(0);
  });
});
