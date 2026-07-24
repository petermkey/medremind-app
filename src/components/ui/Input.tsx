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
          <label htmlFor={inputId} className="text-xs font-semibold text-[#9b978f] uppercase tracking-wide">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[#191d22] border border-[rgba(255,255,255,0.08)] rounded-[12px]',
            'px-4 py-3 text-[#e8e6e1] text-sm outline-none',
            'placeholder:text-[#9b978f]',
            'focus:border-[#d9a53f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2 transition-colors duration-200',
            error ? 'border-[#c96a5a]' : '',
            className,
          ].join(' ')}
          {...rest}
        />
        {error && <p className="text-xs text-[#c96a5a]">{error}</p>}
        {hint && !error && <p className="text-xs text-[#9b978f]">{hint}</p>}
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
          <label htmlFor={inputId} className="text-xs font-semibold text-[#9b978f] uppercase tracking-wide">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[#191d22] border border-[rgba(255,255,255,0.08)] rounded-[12px]',
            'px-4 py-3 text-[#e8e6e1] text-sm outline-none',
            'focus:border-[#d9a53f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2 transition-colors duration-200',
            error ? 'border-[#c96a5a]' : '',
            className,
          ].join(' ')}
          {...rest}
        >
          {options.map(o => (
            <option key={o.value} value={o.value} style={{ background: '#191d22' }}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-[#c96a5a]">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
