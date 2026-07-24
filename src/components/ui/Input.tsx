'use client';
import { forwardRef } from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-[12px]',
            'px-4 py-3 text-[var(--text)] text-sm outline-none',
            'placeholder:text-[var(--muted)]',
            'focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 transition-colors duration-200',
            error ? 'border-[var(--red)]' : '',
            className,
          ].join(' ')}
          {...rest}
        />
        {error && <p className="text-xs text-[var(--red)]">{error}</p>}
        {hint && !error && <p className="text-xs text-[var(--muted)]">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';


interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[var(--surface2)] border border-[rgba(var(--overlay-rgb),0.08)] rounded-[12px]',
            'px-4 py-3 text-[var(--text)] text-sm outline-none',
            'focus:border-[var(--blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 transition-colors duration-200',
            error ? 'border-[var(--red)]' : '',
            className,
          ].join(' ')}
          {...rest}
        >
          {options.map(o => (
            <option key={o.value} value={o.value} style={{ background: 'var(--surface2)' }}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-[var(--red)]">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
