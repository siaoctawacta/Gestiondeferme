import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Field } from './types';
import { useDependentValues } from './useDependentValues';

const OPTIONS = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
const parent = (name = 'p', label = 'Parent'): Field => ({ name, label, type: 'select', options: OPTIONS });
const child = (dependsOn: string, name = 'd', label = 'Enfant'): Field => ({ name, label, type: 'select', dependsOn, options: OPTIONS });

type Values = Record<string, unknown>;

/** A form that holds its values the way ActionDialog does: edits over the stored record. */
function mount(initialFields: Field[], initial: Values) {
  return renderHook(
    ({ fields, values }: { fields: Field[]; values: Values }) => useDependentValues(fields, values),
    { initialProps: { fields: initialFields, values: initial } },
  );
}

describe('useDependentValues', () => {
  it('keeps a stored dependent value while its parent is untouched, whatever the options hold', () => {
    const { result, rerender } = mount([parent(), child('p')], { p: 'a', d: 'gone-from-options' });
    expect(result.current.values).toEqual({ p: 'a', d: 'gone-from-options' });
    act(() => result.current.change('other', 'x'));
    rerender({ fields: [parent(), child('p')], values: { p: 'a', d: 'gone-from-options', other: 'x' } });
    expect(result.current.values.d).toBe('gone-from-options');
  });

  it('clears the dependent value when its parent changes, and accepts a value chosen afterwards', () => {
    const fields = [parent(), child('p')];
    const { result, rerender } = mount(fields, { p: 'a', d: 'a' });
    act(() => result.current.change('p', 'b'));
    rerender({ fields, values: { p: 'b', d: 'a' } });
    expect(result.current.values.d).toBe('');
    act(() => result.current.change('d', 'b'));
    rerender({ fields, values: { p: 'b', d: 'b' } });
    expect(result.current.values.d).toBe('b');
    // The choice does not survive a later change of the parent.
    act(() => result.current.change('p', 'a'));
    rerender({ fields, values: { p: 'a', d: 'b' } });
    expect(result.current.values.d).toBe('');
  });

  it('does not count a change to the same value, nor lose a dependent when the parent is set to what it already is', () => {
    const fields = [parent(), child('p')];
    const { result, rerender } = mount(fields, { p: 'a', d: 'a' });
    act(() => result.current.change('p', 'a'));
    rerender({ fields, values: { p: 'a', d: 'a' } });
    expect(result.current.values.d).toBe('a');
  });

  it('clears down a chain: a grandchild goes with its cleared parent, and does not come back when the parent is picked again', () => {
    const fields = [parent(), child('p', 'd'), child('d', 'g', 'Petit-enfant')];
    const { result, rerender } = mount(fields, { p: 'a', d: 'a', g: 'a' });
    act(() => result.current.change('p', 'b'));
    rerender({ fields, values: { p: 'b', d: 'a', g: 'a' } });
    expect(result.current.values).toMatchObject({ d: '', g: '' });
    act(() => result.current.change('d', 'a'));
    rerender({ fields, values: { p: 'b', d: 'a', g: 'a' } });
    expect(result.current.values).toMatchObject({ d: 'a', g: '' });
  });

  it('clears a value chosen under another parent when dependsOn moves to another field', () => {
    const { result, rerender } = mount([parent('pa'), parent('pb'), child('pa')], {});
    act(() => result.current.change('pa', 'a'));
    act(() => result.current.change('pb', 'a'));
    rerender({ fields: [parent('pa'), parent('pb'), child('pa')], values: { pa: 'a', pb: 'a' } });
    act(() => result.current.change('d', 'a'));
    rerender({ fields: [parent('pa'), parent('pb'), child('pa')], values: { pa: 'a', pb: 'a', d: 'a' } });
    expect(result.current.values.d).toBe('a');
    rerender({ fields: [parent('pa'), parent('pb'), child('pb')], values: { pa: 'a', pb: 'a', d: 'a' } });
    expect(result.current.values.d).toBe('');
  });

  it('never mutates the values it is given', () => {
    const fields = [parent(), child('p')];
    const given = { p: 'b', d: 'a' };
    const { result } = mount(fields, given);
    act(() => result.current.change('p', 'a'));
    expect(given).toEqual({ p: 'b', d: 'a' });
    expect(result.current.values).not.toBe(given);
  });

  it('tells a dependent select its parent value (for a path template) and what it waits for while empty', () => {
    const fields = [parent(), child('p')];
    const { result, rerender } = mount(fields, { p: '' });
    expect(result.current.parentOf(fields[1])).toEqual({ parentValue: '', waitingFor: 'Parent' });
    rerender({ fields, values: { p: 'a' } });
    expect(result.current.parentOf(fields[1])).toEqual({ parentValue: 'a', waitingFor: undefined });
    expect(result.current.parentOf(fields[0])).toEqual({});
  });
});
