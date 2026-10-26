// src/web/components/ui/Form.tsx
/**
 * F.4.99.04 — Form.
 *
 * Обёртка над react-hook-form + zodResolver.
 * FormProvider + render-prop: children может быть функцией (получит methods)
 * или обычным JSX (получит доступ через useFormContext).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
} from 'react-hook-form';
import type {
  FieldErrors,
  FieldValues,
  Path,
  UseFormReturn,
} from 'react-hook-form';
import type { ZodType } from 'zod';

import { colors, fontSize, radius, spacing } from '../../theme';

// ─── Общие типы ──────────────────────────────────────────────────

export interface FormProps<T extends FieldValues> {
  schema: ZodType<T, any, any>;
  onSubmit: (data: T) => Promise<void>;
  defaultValues?: Partial<T>;
  children:
    | ((methods: UseFormReturn<T>) => ReactNode)
    | ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  loading?: boolean;
}

export interface FormFieldProps {
  name: string;
  label?: string;
  required?: boolean;
  description?: string;
  error?: string | null;
  children: ReactNode;
}

export interface FormInputProps {
  name: string;
  label?: string;
  type?: 'text' | 'email' | 'tel' | 'password' | 'number' | 'url';
  placeholder?: string;
  required?: boolean;
  description?: string;
  autoComplete?: string;
  disabled?: boolean;
}

export interface FormSelectOption {
  value: string;
  label: string;
}

export interface FormSelectProps {
  name: string;
  label?: string;
  options: FormSelectOption[];
  required?: boolean;
  placeholder?: string;
}

export interface FormTextareaProps {
  name: string;
  label?: string;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}

export interface FormCheckboxProps {
  name: string;
  label: string;
  required?: boolean;
}

export interface FormActionsProps {
  children: ReactNode;
}

// ─── useFormSubmit ───────────────────────────────────────────────

export interface UseFormSubmitResult<T> {
  submit: (data: T) => Promise<void>;
  loading: boolean;
  error: Error | null;
}

export function useFormSubmit<T>(
  onSubmit: (data: T) => Promise<void>,
): UseFormSubmitResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (data: T): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await onSubmit(data);
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { submit, loading, error };
}

// ─── Форма ───────────────────────────────────────────────────────

export function Form<T extends FieldValues>({
  schema,
  onSubmit,
  defaultValues,
  children,
  submitLabel = 'Отправить',
  cancelLabel,
  onCancel,
  loading = false,
}: FormProps<T>): ReactElement {
  const methods = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as never,
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const busy = loading || isSubmitting;

  const submitHandler = handleSubmit(async (data) => {
    await onSubmit(data as T);
  });

  const renderChildren =
    typeof children === 'function'
      ? children(methods)
      : children;

  return (
    <FormProvider {...methods}>
      <form onSubmit={submitHandler} style={styles.form} noValidate>
        {renderChildren}

        <FormActions>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={styles.btnSecondary}
            >
              {cancelLabel ?? 'Отмена'}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            style={{
              ...styles.btnPrimary,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? '…' : submitLabel}
          </button>
        </FormActions>
      </form>
    </FormProvider>
  );
}

// ─── FormField ───────────────────────────────────────────────────

export function FormField({
  name,
  label,
  required,
  description,
  error,
  children,
}: FormFieldProps): ReactElement {
  // Пытаемся вытащить ошибку из контекста, если error не передан явно
  let ctxError: string | null = null;
  try {
    const { formState } = useFormContext();
    ctxError = getErrorByPath(formState.errors, name);
  } catch {
    // вне Form — ок, используем props.error
  }
  const shown = error ?? ctxError;

  return (
    <div style={styles.field}>
      {label ? (
        <label htmlFor={name} style={styles.label}>
          {label}
          {required ? <span style={styles.required}> *</span> : null}
        </label>
      ) : null}
      {children}
      {description && !shown ? (
        <span style={styles.description}>{description}</span>
      ) : null}
      {shown ? <span style={styles.errorText}>{shown}</span> : null}
    </div>
  );
}

// ─── FormInput ───────────────────────────────────────────────────

export function FormInput({
  name,
  label,
  type = 'text',
  placeholder,
  required,
  description,
  autoComplete,
  disabled = false,
}: FormInputProps): ReactElement {
  const { register } = useFormContext();
  return (
    <FormField
      name={name}
      {...(label ? { label } : {})}
      {...(required ? { required } : {})}
      {...(description ? { description } : {})}
    >
      <input
        id={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        {...register(name, {
          valueAsNumber: type === 'number',
        })}
        style={styles.input}
      />
    </FormField>
  );
}

// ─── FormSelect ──────────────────────────────────────────────────

export function FormSelect({
  name,
  label,
  options,
  required,
  placeholder,
}: FormSelectProps): ReactElement {
  const { register } = useFormContext();
  return (
    <FormField
      name={name}
      {...(label ? { label } : {})}
      {...(required ? { required } : {})}
    >
      <select id={name} {...register(name)} style={styles.input}>
        {placeholder ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// ─── FormTextarea ────────────────────────────────────────────────

export function FormTextarea({
  name,
  label,
  rows = 4,
  placeholder,
  required,
  maxLength,
}: FormTextareaProps): ReactElement {
  const { register } = useFormContext();
  return (
    <FormField
      name={name}
      {...(label ? { label } : {})}
      {...(required ? { required } : {})}
    >
      <textarea
        id={name}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        {...register(name)}
        style={{ ...styles.input, resize: 'vertical' as const }}
      />
    </FormField>
  );
}

// ─── FormCheckbox ────────────────────────────────────────────────

export function FormCheckbox({
  name,
  label,
  required,
}: FormCheckboxProps): ReactElement {
  const { register } = useFormContext();
  return (
    <label style={styles.checkboxRow}>
      <input
        type="checkbox"
        {...register(name)}
        style={styles.checkbox}
      />
      <span style={styles.checkboxLabel}>
        {label}
        {required ? <span style={styles.required}> *</span> : null}
      </span>
    </label>
  );
}

// ─── FormActions ─────────────────────────────────────────────────

export function FormActions({ children }: FormActionsProps): ReactElement {
  return <div style={styles.actions}>{children}</div>;
}

// ─── Утилита: извлечение ошибки по пути ──────────────────────────

function getErrorByPath(
  errors: FieldErrors,
  path: string,
): string | null {
  const parts = path.split('.');
  let cur: unknown = errors;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  if (cur && typeof cur === 'object' && 'message' in cur) {
    const msg = (cur as { message: unknown }).message;
    return msg ? String(msg) : null;
  }
  return null;
}

// ─── Утилита: маппинг серверных ошибок на поля ───────────────────

export interface ServerFieldError {
  path: string;
  message: string;
}

/**
 * Применяет серверные ошибки к форме.
 * Использование:
 *   const { setError } = useFormContext();
 *   applyServerErrors(setError, apiError.details?.fields ?? []);
 */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormReturn<T>['setError'],
  fields: ServerFieldError[],
): void {
  for (const f of fields) {
    setError(f.path as Path<T>, { type: 'server', message: f.message });
  }
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  form: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  field: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  required: {
    color: colors.danger,
  },
  description: {
    color: colors.textDim,
    fontSize: fontSize.xs,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.xs,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    color: colors.text,
    padding: '8px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  checkboxRow: {
    display: 'flex' as const,
    alignItems: 'flex-start' as const,
    gap: spacing.sm,
    cursor: 'pointer',
  },
  checkbox: {
    marginTop: 2,
  },
  checkboxLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  btnPrimary: {
    background: colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: radius.md,
    padding: '8px 16px',
    fontSize: fontSize.sm,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSecondary: {
    background: 'transparent',
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: '8px 16px',
    fontSize: fontSize.sm,
    fontWeight: 500,
    cursor: 'pointer',
  },
};