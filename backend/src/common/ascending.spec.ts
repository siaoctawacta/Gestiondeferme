import { ascending } from './ascending';

describe('ascending', () => {
  it('returns the distinct ids in ascending order, without the empty ones', () => {
    expect(ascending(['b', null, 'a', 'b', undefined, ''])).toEqual(['a', 'b']);
  });
});
