'use client';
import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

const styles: Record<Variant, string> = {
  primary:   'bg-[#3B82F6] text-white hover:bg-[#2563EB] shadow-[0_8px_32px_rgba(59,130,246,0.35)]',
  secondary: 'bg-transparent border border-[rgba(255,255,255,0.08)] text-[#F0F6FC] hover:border-[#3B82F6] hover:text-[#3B82F6]',
  ghost:     'bg-transparent text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[rgba(255,255,255,0.05)]',
  danger:    'bg-[#EF4444] text-white hover:bg-[#DC2626]',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-2 text-sm rounded-[9px]',
  md: 'px-5 py-3 text-sm rounded-[14px]',
  lg: 'px-6 py-4 text-base rounded-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, className = '', children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant], sizes[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
);
Button.displayName = 'Button';
