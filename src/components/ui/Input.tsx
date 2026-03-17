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
          <label htmlFor={inputId} className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-[12px]',
            'px-4 py-3 text-[#F0F6FC] text-sm outline-none',
            'placeholder:text-[#8B949E]',
            'focus:border-[#3B82F6] transition-colors duration-200',
            error ? 'border-[#EF4444]' : '',
            className,
          ].join(' ')}
          {...rest}
        />
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        {hint && !error && <p className="text-xs text-[#8B949E]">{hint}</p>}
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
          <label htmlFor={inputId} className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-[12px]',
            'px-4 py-3 text-[#F0F6FC] text-sm outline-none',
            'focus:border-[#3B82F6] transition-colors duration-200',
            error ? 'border-[#EF4444]' : '',
            className,
          ].join(' ')}
          {...rest}
        >
          {options.map(o => (
            <option key={o.value} value={o.value} style={{ background: '#1C2333' }}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
