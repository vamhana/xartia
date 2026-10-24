// src/web/pages/_FormDemo.tsx
import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { Card } from '../components/ui/Card';
import {
  Form,
  FormInput,
  FormSelect,
  FormTextarea,
  FormCheckbox,
} from '../components/ui/Form';

const demoSchema = z.object({
  name: z.string().min(3, 'Минимум 3 символа').max(64),
  age: z.coerce
    .number()
    .int('Целое число')
    .min(18, 'С 18 лет')
    .max(120, 'Слишком много'),
  role: z.enum(['user', 'admin', 'moderator'], {
    message: 'Выберите роль',
  }),
  bio: z.string().max(500, 'Не более 500 символов').optional(),
  agree: z.literal(true, {
    message: 'Обязательно согласие',
  }),
});

type DemoForm = z.infer<typeof demoSchema>;

export function FormDemoPage(): ReactElement {
  const [result, setResult] = useState<DemoForm | null>(null);

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Form Demo</h1>

      <Card title="Регистрация" subtitle="Все поля обязательные, кроме bio">
        <Form<DemoForm>
          schema={demoSchema}
          defaultValues={{ role: 'user' }}
          submitLabel="Создать"
          onCancel={() => console.warn('cancel')}
          onSubmit={async (data) => {
            console.warn('submit', data);
            await new Promise((r) => setTimeout(r, 500));
            setResult(data);
          }}
        >
          <FormInput
            name="name"
            label="Имя"
            placeholder="Иван"
            required
            autoComplete="name"
          />
          <FormInput
            name="age"
            label="Возраст"
            type="number"
            placeholder="18"
            required
          />
          <FormSelect
            name="role"
            label="Роль"
            required
            options={[
              { value: 'user', label: 'Пользователь' },
              { value: 'admin', label: 'Администратор' },
              { value: 'moderator', label: 'Модератор' },
            ]}
          />
          <FormTextarea
            name="bio"
            label="О себе"
            rows={3}
            placeholder="Пара слов…"
            maxLength={500}
          />
          <FormCheckbox
            name="agree"
            label="Согласен с условиями"
            required
          />
        </Form>
      </Card>

      {result ? (
        <Card title="Результат">
          <pre style={{ margin: 0, fontSize: 12, color: '#e2e8f0' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}