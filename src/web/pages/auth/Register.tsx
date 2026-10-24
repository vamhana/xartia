// src/web/pages/auth/Register.tsx
/**
 * F.4.01.03 — Register page.
 *
 * Форма регистрации: phone + 3 мессенджера (мин. 1) + password + 2 согласия.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { apiPost, type ApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import {
  Form,
  FormInput,
  FormCheckbox,
} from '../../components/ui/Form';
import { colors, fontSize, spacing } from '../../theme';

// ─── Схема ───────────────────────────────────────────────────────

const registerSchema = z
  .object({
    phone: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Телефон должен быть в формате E.164 (например +79000000000)',
      ),
    password: z
      .string()
      .min(12, 'Пароль должен быть не короче 12 символов')
      .max(128, 'Пароль слишком длинный'),
    telegram: z.string().max(128).optional(),
    whatsapp: z.string().max(128).optional(),
    signal: z.string().max(128).optional(),
    consent_video: z.literal(true, {
      errorMap: () => ({
        message: 'Требуется согласие на видео-интервью',
      }),
    }),
    consent_data: z.literal(true, {
      errorMap: () => ({
        message: 'Требуется согласие на обработку данных',
      }),
    }),
  })
  .refine(
    (d) => Boolean(d.telegram || d.whatsapp || d.signal),
    {
      message: 'Укажите хотя бы один мессенджер',
      path: ['telegram'],
    },
  );

type RegisterForm = z.infer<typeof registerSchema>;

interface RegisterResponse {
  request_id: string;
  status: string;
  audit_id: string;
}

// ─── Компонент ───────────────────────────────────────────────────

export function RegisterPage(): ReactElement {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const onSubmit = async (data: RegisterForm): Promise<void> => {
    setServerError(null);

    const messengers: Record<string, string> = {};
    if (data.telegram) {messengers['telegram'] = data.telegram;}
    if (data.whatsapp) {messengers['whatsapp'] = data.whatsapp;}
    if (data.signal) {messengers['signal'] = data.signal;}

    try {
      const res = await apiPost<RegisterResponse>('/auth/register', {
        phone: data.phone,
        messengers,
        password: data.password,
        consent_video: true,
        consent_data: true,
      });
      navigate(`/waiting/${res.request_id}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        setServerError('Этот телефон уже зарегистрирован');
      } else if (err.status === 422) {
        setServerError(err.message || 'Проверьте формат полей');
      } else if (err.status === 429) {
        setServerError(
          'Слишком много попыток регистрации. Попробуйте позже.',
        );
      } else {
        setServerError(err.message || 'Не удалось отправить заявку');
      }
    }
  };

  return (
    <div style={styles.page}>
      <Card
        title="Регистрация"
        subtitle="Заявка на вступление в Хартию"
      >
        <Form<RegisterForm>
          schema={registerSchema}
          defaultValues={{
            phone: '',
            password: '',
            telegram: undefined,
            whatsapp: undefined,
            signal: undefined,
            consent_video: false as unknown as true,
            consent_data: false as unknown as true,
          }}
          submitLabel="Отправить заявку"
          onSubmit={onSubmit}
        >
          <FormInput
            name="phone"
            label="Телефон"
            type="tel"
            placeholder="+79000000000"
            required
            autoComplete="tel"
          />
          <FormInput
            name="password"
            label="Пароль"
            type="password"
            placeholder="Минимум 12 символов"
            required
            autoComplete="new-password"
            description="Строчные, заглавные буквы и цифры"
          />

          <div style={styles.messengerBlock}>
            <div style={styles.messengerHeader}>
              <span style={styles.messengerTitle}>Мессенджеры</span>
              <span style={styles.messengerHint}>
                Укажите хотя бы один — Telegram, WhatsApp или Signal
              </span>
            </div>
            <FormInput
              name="telegram"
              placeholder="@username в Telegram"
            />
            <FormInput
              name="whatsapp"
              placeholder="+7… (WhatsApp)"
            />
            <FormInput
              name="signal"
              placeholder="+7… (Signal)"
            />
          </div>

          <div style={styles.consentBlock}>
            <FormCheckbox
              name="consent_video"
              label="Согласен на видео-интервью с Советом Интервьюеров"
              required
            />
            <FormCheckbox
              name="consent_data"
              label="Согласен на обработку персональных данных в закрытом контуре"
              required
            />
          </div>

          {serverError ? (
            <div style={styles.error}>{serverError}</div>
          ) : null}
        </Form>

        <p style={styles.note}>
          Уже зарегистрированы?{' '}
          <Link to="/login" style={styles.link}>
            Войти
          </Link>
        </p>
      </Card>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.lg,
    background: colors.bg,
  },
  messengerBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  messengerHeader: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 2,
    marginBottom: 2,
  },
  messengerTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  messengerHint: {
    color: colors.textDim,
    fontSize: fontSize.xs,
  },
  consentBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: `1px solid rgba(239,68,68,0.3)`,
    borderRadius: 6,
    padding: '8px 12px',
  },
  note: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
  },
  link: {
    color: colors.primary,
    textDecoration: 'none',
  },
};