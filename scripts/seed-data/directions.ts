// I.9.05.05 — Справочник 17 направлений Хартии.
// НЕ создаёт directions в БД (это делает миграция 007_seeds.sql / bootstrap).
// Используется как sanity-check: сид проверяет, что в БД 17 активных направлений
// и что номера совпадают. При расхождении — warning (не fail: Хартия может
// меняться, но маппинг должен продолжать работать).

export interface DirectionSeed {
  number: number;
  name: string;
  type: 'permanent' | 'temporary';
}

export const DIRECTION_SEEDS: DirectionSeed[] = [
  { number: 1,  name: 'Жизнеобеспечение',          type: 'permanent' },
  { number: 2,  name: 'Здравие',                   type: 'permanent' },
  { number: 3,  name: 'Энергия и Среда',           type: 'permanent' },
  { number: 4,  name: 'Трансляция Контекста',      type: 'permanent' },
  { number: 5,  name: 'Когнитивная Логистика',     type: 'permanent' },
  { number: 6,  name: 'Ноология',                  type: 'permanent' },
  { number: 7,  name: 'Инженерия Обнуления',       type: 'permanent' },
  { number: 8,  name: 'Балансировка',              type: 'permanent' },
  { number: 9,  name: 'Кибернетика и Протокол',    type: 'permanent' },
  { number: 10, name: 'Искусство и Резонанс',      type: 'permanent' },
  { number: 11, name: 'Социальная Инкубация',      type: 'permanent' },
  { number: 12, name: 'Психоэкология',             type: 'permanent' },
  { number: 13, name: 'Верификация и Надёжность',  type: 'permanent' },
  { number: 14, name: 'Знание и Образование',      type: 'permanent' },
  { number: 15, name: 'Внешний шлюз',              type: 'temporary' },
  { number: 16, name: 'Сетевая экосистема',        type: 'temporary' },
  { number: 17, name: 'Правозащита и Восстановление', type: 'permanent' },
];