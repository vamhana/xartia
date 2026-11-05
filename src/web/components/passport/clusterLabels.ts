// F.4.10.00 — Словари кластеров (единый источник для Overview/CompetencyMap/Timeline).

export const CLUSTER_LABEL: Record<string, string> = {
  requirements_and_computational_thinking: 'Требования и вычисл. мышление',
  software_development: 'Разработка программ',
  data_and_databases: 'Данные и БД',
  server_interfaces_and_api: 'Серверные интерфейсы и API',
  testing_and_quality: 'Тестирование и качество',
  software_security: 'Безопасность ПО',
  infrastructure_and_operations: 'Инфраструктура и эксплуатация',
};

// Короткие подписи для SVG (в узких кругах длинные имена не помещаются).
export const CLUSTER_SHORT: Record<string, string> = {
  requirements_and_computational_thinking: 'Требования',
  software_development: 'Разработка',
  data_and_databases: 'Данные',
  server_interfaces_and_api: 'API',
  testing_and_quality: 'Тесты',
  software_security: 'Безопасность',
  infrastructure_and_operations: 'Инфра',
};