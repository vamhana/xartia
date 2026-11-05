// I.9.09.02 — Связи между атомами (пилот v0.3.0).
// Типы: part_of | requires | prerequisite_for | alternative_to |
//       shared_foundation | applied_in | related_to (паспорт 4.2).
// Дедуп — UNIQUE (from, to, type) в БД. Дубликаты в массиве допустимы:
// загрузчик сделает ON CONFLICT DO NOTHING.

import type { RelationType } from '../../src/core/passport/types.js';

export interface RelationSeed {
  from: string;
  to: string;
  type: RelationType;
  note?: string;
}

export const RELATION_SEEDS: RelationSeed[] = [
  // Требования и вычислительное мышление
  { from: 'CYB.ATOM.0001', to: 'CYB.ATOM.0002', type: 'related_to' },
  { from: 'CYB.ATOM.0001', to: 'CYB.ATOM.0003', type: 'related_to' },
  { from: 'CYB.ATOM.0002', to: 'CYB.ATOM.0004', type: 'related_to' },
  { from: 'CYB.ATOM.0002', to: 'CYB.ATOM.0009', type: 'related_to' },
  { from: 'CYB.ATOM.0003', to: 'CYB.ATOM.0010', type: 'related_to' },
  { from: 'CYB.ATOM.0003', to: 'CYB.ATOM.0025', type: 'related_to' },
  { from: 'CYB.ATOM.0004', to: 'CYB.ATOM.0013', type: 'related_to' },
  { from: 'CYB.ATOM.0004', to: 'CYB.ATOM.0024', type: 'related_to' },
  { from: 'CYB.ATOM.0004', to: 'CYB.ATOM.0032', type: 'related_to' },
  { from: 'CYB.ATOM.0005', to: 'CYB.ATOM.0006', type: 'related_to' },
  { from: 'CYB.ATOM.0005', to: 'CYB.ATOM.0007', type: 'related_to' },
  { from: 'CYB.ATOM.0006', to: 'CYB.ATOM.0009', type: 'related_to' },
  { from: 'CYB.ATOM.0007', to: 'CYB.ATOM.0054', type: 'related_to' },
  { from: 'CYB.ATOM.0008', to: 'CYB.ATOM.0001', type: 'related_to' },
  { from: 'CYB.ATOM.0008', to: 'CYB.ATOM.0005', type: 'related_to' },
  { from: 'CYB.ATOM.0008', to: 'CYB.ATOM.0006', type: 'related_to' },

  // Разработка программ
  { from: 'CYB.ATOM.0009', to: 'CYB.ATOM.0010', type: 'related_to' },
  { from: 'CYB.ATOM.0009', to: 'CYB.ATOM.0013', type: 'related_to' },
  { from: 'CYB.ATOM.0010', to: 'CYB.ATOM.0001', type: 'related_to' },
  { from: 'CYB.ATOM.0011', to: 'CYB.ATOM.0010', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0011', to: 'CYB.ATOM.0018', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0011', to: 'CYB.ATOM.0024', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0012', to: 'CYB.ATOM.0013', type: 'related_to' },
  { from: 'CYB.ATOM.0012', to: 'CYB.ATOM.0051', type: 'related_to' },
  { from: 'CYB.ATOM.0013', to: 'CYB.ATOM.0002', type: 'requires' },
  { from: 'CYB.ATOM.0013', to: 'CYB.ATOM.0012', type: 'requires' },
  { from: 'CYB.ATOM.0014', to: 'CYB.ATOM.0036', type: 'related_to' },
  { from: 'CYB.ATOM.0014', to: 'CYB.ATOM.0052', type: 'related_to' },
  { from: 'CYB.ATOM.0015', to: 'CYB.ATOM.0009', type: 'requires' },
  { from: 'CYB.ATOM.0015', to: 'CYB.ATOM.0031', type: 'requires' },
  { from: 'CYB.ATOM.0016', to: 'CYB.ATOM.0045', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0017', to: 'CYB.ATOM.0016', type: 'related_to' },
  { from: 'CYB.ATOM.0018', to: 'CYB.ATOM.0010', type: 'requires' },
  { from: 'CYB.ATOM.0018', to: 'CYB.ATOM.0017', type: 'requires' },

  // Данные
  { from: 'CYB.ATOM.0020', to: 'CYB.ATOM.0019', type: 'requires' },
  { from: 'CYB.ATOM.0020', to: 'CYB.ATOM.0021', type: 'related_to' },
  { from: 'CYB.ATOM.0021', to: 'CYB.ATOM.0054', type: 'related_to' },
  { from: 'CYB.ATOM.0022', to: 'CYB.ATOM.0019', type: 'requires' },
  { from: 'CYB.ATOM.0022', to: 'CYB.ATOM.0024', type: 'requires' },
  { from: 'CYB.ATOM.0023', to: 'CYB.ATOM.0019', type: 'requires' },
  { from: 'CYB.ATOM.0023', to: 'CYB.ATOM.0022', type: 'requires' },
  { from: 'CYB.ATOM.0024', to: 'CYB.ATOM.0052', type: 'related_to' },

  // Server / API
  { from: 'CYB.ATOM.0025', to: 'CYB.ATOM.0001', type: 'requires' },
  { from: 'CYB.ATOM.0025', to: 'CYB.ATOM.0010', type: 'requires' },
  { from: 'CYB.ATOM.0025', to: 'CYB.ATOM.0026', type: 'requires' },
  { from: 'CYB.ATOM.0025', to: 'CYB.ATOM.0033', type: 'requires' },
  { from: 'CYB.ATOM.0026', to: 'CYB.ATOM.0025', type: 'requires' },
  { from: 'CYB.ATOM.0026', to: 'CYB.ATOM.0009', type: 'requires' },
  { from: 'CYB.ATOM.0027', to: 'CYB.ATOM.0002', type: 'requires' },
  { from: 'CYB.ATOM.0027', to: 'CYB.ATOM.0039', type: 'related_to' },
  { from: 'CYB.ATOM.0028', to: 'CYB.ATOM.0013', type: 'requires' },
  { from: 'CYB.ATOM.0028', to: 'CYB.ATOM.0025', type: 'requires' },

  // Тестирование
  { from: 'CYB.ATOM.0029', to: 'CYB.ATOM.0001', type: 'requires' },
  { from: 'CYB.ATOM.0029', to: 'CYB.ATOM.0030', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0030', to: 'CYB.ATOM.0029', type: 'requires' },
  { from: 'CYB.ATOM.0030', to: 'CYB.ATOM.0031', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0030', to: 'CYB.ATOM.0032', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0030', to: 'CYB.ATOM.0033', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0031', to: 'CYB.ATOM.0030', type: 'requires' },
  { from: 'CYB.ATOM.0031', to: 'CYB.ATOM.0034', type: 'requires' },
  { from: 'CYB.ATOM.0032', to: 'CYB.ATOM.0030', type: 'requires' },
  { from: 'CYB.ATOM.0032', to: 'CYB.ATOM.0034', type: 'requires' },
  { from: 'CYB.ATOM.0032', to: 'CYB.ATOM.0045', type: 'related_to' },
  { from: 'CYB.ATOM.0033', to: 'CYB.ATOM.0025', type: 'requires' },
  { from: 'CYB.ATOM.0033', to: 'CYB.ATOM.0026', type: 'related_to' },
  { from: 'CYB.ATOM.0034', to: 'CYB.ATOM.0031', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0034', to: 'CYB.ATOM.0032', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0034', to: 'CYB.ATOM.0033', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0029', type: 'requires' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0030', type: 'requires' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0031', type: 'requires' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0032', type: 'requires' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0033', type: 'requires' },
  { from: 'CYB.ATOM.0035', to: 'CYB.ATOM.0034', type: 'requires' },
  { from: 'CYB.ATOM.0036', to: 'CYB.ATOM.0014', type: 'related_to' },
  { from: 'CYB.ATOM.0036', to: 'CYB.ATOM.0035', type: 'related_to' },

  // Безопасность
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0038', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0039', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0040', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0041', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0042', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0043', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0037', to: 'CYB.ATOM.0044', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0038', to: 'CYB.ATOM.0027', type: 'requires' },
  { from: 'CYB.ATOM.0038', to: 'CYB.ATOM.0037', type: 'requires' },
  { from: 'CYB.ATOM.0039', to: 'CYB.ATOM.0045', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0039', to: 'CYB.ATOM.0046', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0039', to: 'CYB.ATOM.0047', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0039', to: 'CYB.ATOM.0048', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0040', to: 'CYB.ATOM.0037', type: 'requires' },
  { from: 'CYB.ATOM.0040', to: 'CYB.ATOM.0039', type: 'requires' },
  { from: 'CYB.ATOM.0041', to: 'CYB.ATOM.0017', type: 'requires' },
  { from: 'CYB.ATOM.0041', to: 'CYB.ATOM.0045', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0042', to: 'CYB.ATOM.0037', type: 'related_to' },
  { from: 'CYB.ATOM.0042', to: 'CYB.ATOM.0039', type: 'related_to' },
  { from: 'CYB.ATOM.0043', to: 'CYB.ATOM.0042', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0044', to: 'CYB.ATOM.0050', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0044', to: 'CYB.ATOM.0052', type: 'prerequisite_for' },

  // Инфраструктура
  { from: 'CYB.ATOM.0045', to: 'CYB.ATOM.0017', type: 'requires' },
  { from: 'CYB.ATOM.0045', to: 'CYB.ATOM.0046', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0045', to: 'CYB.ATOM.0047', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0045', to: 'CYB.ATOM.0048', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0046', to: 'CYB.ATOM.0045', type: 'requires' },
  { from: 'CYB.ATOM.0046', to: 'CYB.ATOM.0041', type: 'requires' },
  { from: 'CYB.ATOM.0047', to: 'CYB.ATOM.0016', type: 'requires' },
  { from: 'CYB.ATOM.0047', to: 'CYB.ATOM.0017', type: 'requires' },
  { from: 'CYB.ATOM.0047', to: 'CYB.ATOM.0031', type: 'requires' },
  { from: 'CYB.ATOM.0047', to: 'CYB.ATOM.0032', type: 'requires' },
  { from: 'CYB.ATOM.0047', to: 'CYB.ATOM.0041', type: 'requires' },
  { from: 'CYB.ATOM.0048', to: 'CYB.ATOM.0045', type: 'requires' },
  { from: 'CYB.ATOM.0048', to: 'CYB.ATOM.0047', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0048', to: 'CYB.ATOM.0049', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0049', to: 'CYB.ATOM.0045', type: 'requires' },
  { from: 'CYB.ATOM.0049', to: 'CYB.ATOM.0048', type: 'requires' },
  { from: 'CYB.ATOM.0049', to: 'CYB.ATOM.0052', type: 'related_to' },
  { from: 'CYB.ATOM.0050', to: 'CYB.ATOM.0014', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0050', to: 'CYB.ATOM.0051', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0050', to: 'CYB.ATOM.0052', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0051', to: 'CYB.ATOM.0052', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0052', to: 'CYB.ATOM.0024', type: 'requires' },
  { from: 'CYB.ATOM.0052', to: 'CYB.ATOM.0049', type: 'requires' },
  { from: 'CYB.ATOM.0052', to: 'CYB.ATOM.0050', type: 'requires' },
  { from: 'CYB.ATOM.0052', to: 'CYB.ATOM.0051', type: 'requires' },
  { from: 'CYB.ATOM.0052', to: 'CYB.ATOM.0014', type: 'related_to' },
  { from: 'CYB.ATOM.0053', to: 'CYB.ATOM.0045', type: 'requires' },
  { from: 'CYB.ATOM.0053', to: 'CYB.ATOM.0049', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0053', to: 'CYB.ATOM.0052', type: 'prerequisite_for' },
  { from: 'CYB.ATOM.0054', to: 'CYB.ATOM.0007', type: 'related_to' },
  { from: 'CYB.ATOM.0054', to: 'CYB.ATOM.0021', type: 'related_to' },
  { from: 'CYB.ATOM.0054', to: 'CYB.ATOM.0050', type: 'related_to' },
  // alternative_to — пилот Фазы 2 (в каталоге таких связей нет, добавлены
  // для проверки §7.3 / путей развития).
  {
    from: 'CYB.ATOM.0032', to: 'CYB.ATOM.0033', type: 'alternative_to',
    note: 'Проверка API-взаимодействия: интеграционный vs контрактный тест. ' +
      'Условия применимости различаются (полный стек vs только контракт).',
  },
  {
    from: 'CYB.ATOM.0045', to: 'CYB.ATOM.0046', type: 'alternative_to',
    note: 'Воспроизводимая среда: локальная конфигурация (VM/process) vs контейнер. ' +
      'Не эквивалентны: контейнер покрывает подмножество случаев.',
  },
  {
    from: 'CYB.ATOM.0053', to: 'CYB.ATOM.0046', type: 'alternative_to',
    note: 'Запуск сервиса: управление процессами ОС vs контейнер. ' +
      'В контейнерных средах 0053 не требуется в явном виде.',
  },
];
