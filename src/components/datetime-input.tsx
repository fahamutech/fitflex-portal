'use client';
import { useEffect, useState } from 'react';
import { fromLocalInput, toLocalInput } from '@/lib/promotions';

/**
 * A date-and-time field. The value in and out is an ISO instant ('' when empty);
 * what the admin sees and types is their own local clock.
 */
export function DateTimeInput({ value, onChange, min, ...rest }: {
  value: string; onChange: (iso: string) => void; min?: string; id?: string; required?: boolean; 'data-testid'?: string;
}) {
  const [text, setText] = useState(toLocalInput(value));
  // Follow outside changes (loading a draft) without fighting what is being typed.
  useEffect(() => { if (fromLocalInput(text) !== value) setText(toLocalInput(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="datetime-local" className="ui-input" value={text} min={min ? toLocalInput(min) : undefined}
      onChange={e => { setText(e.target.value); onChange(fromLocalInput(e.target.value)); }} {...rest} />
  );
}
DateTimeInput.acceptsId = true;
