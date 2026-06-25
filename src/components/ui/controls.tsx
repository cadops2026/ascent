import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react'
import { MicroLabel } from './MicroLabel'

const fieldClass =
  'w-full rounded-lg border border-line bg-panel-hi px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-teal/60'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <MicroLabel>{label}</MicroLabel>
      {children}
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${className}`} />
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={`${fieldClass} ${className}`}>
      {children}
    </select>
  )
}

type ButtonVariant = 'primary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-teal/15 text-teal hover:bg-teal/25',
    ghost: 'border border-line text-muted hover:text-ink',
    danger: 'text-coral hover:bg-coral/10',
  }
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />
}
