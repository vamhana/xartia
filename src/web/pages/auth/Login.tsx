// F.4.01.02 — Страница входа
// Форма: телефон (E.164), пароль. Валидация на клиенте. Обработка 401/429.


import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import type { ApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { colors } from '../../theme';

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Если уже авторизован — сразу на главную.
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!PHONE_RE.test(phone)) {
      setError('Телефон должен быть в формате E.164, например +79000000000');
      return;
    }
    if (password.length < 1) {
      setError('Введите пароль');
      return;
    }

    setLoading(true);
    try {
      await login(phone, password);
      navigate('/', { replace: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        setError('Неверный телефон или пароль');
      } else if (err.status === 429) {
        setError('Слишком много попыток. Попробуйте через несколько минут.');
      } else if (err.status === 422) {
        setError('Проверьте формат полей');
      } else {
        setError(err.message || 'Ошибка входа');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={onSubmit}>
        <h1 style={styles.h1}>XartIA Charter 5.0</h1>
        <p style={styles.subtitle}>Вход в систему</p>

        <label style={styles.label}>
          Телефон
          <input
            type="tel"
            autoComplete="username"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={styles.input}
            placeholder="+79000000000"
            disabled={loading}
          />
        </label>

        <label style={styles.label}>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            disabled={loading}
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.btn} disabled={loading}>
          {loading ? 'Вход…' : 'Войти'}
        </button>

        <p style={styles.note}>
          Нет аккаунта?{' '}
          <Link to="/register" style={{ color: '#60a5fa' }}>
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </div>
  );
}

// -------- Стили --------

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    color: colors.text,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
    padding: 20,
  } as const,
  card: {
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 32,
    minWidth: 340,
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  } as const,
  h1: { margin: 0, fontSize: 22 } as const,
  subtitle: { margin: 0, color: colors.textMuted, fontSize: 14, marginBottom: 8 } as const,
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    fontSize: 13,
    color: colors.textMuted,
  } as const,
  input: {
    padding: '10px 12px',
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontSize: 15,
    outline: 'none',
  } as const,
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 13,
  } as const,
  btn: {
    marginTop: 8,
    padding: '11px 16px',
    background: colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
  } as const,
  note: { color: colors.textDim, fontSize: 12, margin: '8px 0 0' } as const,
};