import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'a', label: 'Aa' },
  { value: 'b', label: 'Bb' },
  { value: 'c', label: 'Cc' },
] as const;

function Harness({ onChange = () => undefined }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return (
    <>
      <button>avant</button>
      <Segmented label="Choix" value={value} options={[...OPTIONS]} onChange={(v) => { setValue(v); onChange(v); }} />
      <button>après</button>
    </>
  );
}

describe('Segmented', () => {
  it('has a single tab stop: the checked option', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Aa' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Bb' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Cc' })).toHaveAttribute('tabindex', '-1');
  });

  it('tabs into the group on the checked option and out of it in one step', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'avant' }));
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Aa' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'après' })).toHaveFocus();
  });

  it('moves the choice and the focus with the arrow keys, wrapping around', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    screen.getByRole('radio', { name: 'Aa' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Bb' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Bb' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bb' })).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Cc' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('c');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Aa' })).toBeChecked();
  });
});
