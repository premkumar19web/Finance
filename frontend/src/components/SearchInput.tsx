import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/useApi';

/** Text box that reports its value only after the user pauses typing. */
export function SearchInput({ id, value, onChange, placeholder }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text.trim());
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (debounced !== value) onChangeRef.current(debounced);
    // Only react to what the user typed, not to outside changes of `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <input id={id} className="input" type="search" placeholder={placeholder} value={text}
      onChange={(e) => setText(e.target.value)} />
  );
}
