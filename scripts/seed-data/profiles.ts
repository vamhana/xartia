// I.9.09.03 — Три профессиональных профиля пилота (v0.3.0, §7).
// Требования — ГИПОТЕЗА: min по U/X/D/P/E = {3,2,2,3,2}, calibration='pending'.
// Пересматривается в Фазе 2 после калибровки 0–9.
//
// Профиль — не «присвоение профессии», а версионируемая конфигурация
// требований (паспорт 10.1, 10.2).

import type { AtomStatus, ProfileRequirements } from '../../src/core/passport/types.js';

export interface ProfileSeed {
  slug: string;
  name: string;
  version: string;
  status: AtomStatus;
  requirements: ProfileRequirements;
}

// Дефолтные минимальные уровни (гипотеза).
const MIN_DEFAULT = { U: 3, X: 2, D: 2, P: 3, E: 2 } as const;

function requirements(atomIds: string[]): ProfileRequirements {
  return {
    atoms: atomIds.map((atom_id) => ({ atom_id, min: { ...MIN_DEFAULT } })),
    aggregates: { width_min: 15, depth_min: 2 },
    alternatives: [],
    context: { domain: 'pilot', scale: 'team' },
    calibration: 'pending',
  };
}

const PYTHON_BACKEND_ATOMS = [
  'CYB.ATOM.0001', 'CYB.ATOM.0002', 'CYB.ATOM.0003', 'CYB.ATOM.0005',
  'CYB.ATOM.0006', 'CYB.ATOM.0007', 'CYB.ATOM.0009', 'CYB.ATOM.0010',
  'CYB.ATOM.0011', 'CYB.ATOM.0012', 'CYB.ATOM.0013', 'CYB.ATOM.0014',
  'CYB.ATOM.0015', 'CYB.ATOM.0016', 'CYB.ATOM.0017', 'CYB.ATOM.0018',
  'CYB.ATOM.0019', 'CYB.ATOM.0020', 'CYB.ATOM.0021', 'CYB.ATOM.0022',
  'CYB.ATOM.0023', 'CYB.ATOM.0025', 'CYB.ATOM.0026', 'CYB.ATOM.0027',
  'CYB.ATOM.0028', 'CYB.ATOM.0031', 'CYB.ATOM.0032', 'CYB.ATOM.0037',
  'CYB.ATOM.0038', 'CYB.ATOM.0039', 'CYB.ATOM.0040', 'CYB.ATOM.0042',
  'CYB.ATOM.0043', 'CYB.ATOM.0045', 'CYB.ATOM.0047', 'CYB.ATOM.0049',
  'CYB.ATOM.0050', 'CYB.ATOM.0054',
];

const QA_AUTOMATION_ATOMS = [
  'CYB.ATOM.0001', 'CYB.ATOM.0002', 'CYB.ATOM.0003', 'CYB.ATOM.0004',
  'CYB.ATOM.0008', 'CYB.ATOM.0013', 'CYB.ATOM.0014', 'CYB.ATOM.0016',
  'CYB.ATOM.0017', 'CYB.ATOM.0025', 'CYB.ATOM.0027', 'CYB.ATOM.0028',
  'CYB.ATOM.0029', 'CYB.ATOM.0030', 'CYB.ATOM.0031', 'CYB.ATOM.0032',
  'CYB.ATOM.0033', 'CYB.ATOM.0034', 'CYB.ATOM.0035', 'CYB.ATOM.0036',
  'CYB.ATOM.0037', 'CYB.ATOM.0038', 'CYB.ATOM.0041', 'CYB.ATOM.0044',
  'CYB.ATOM.0045', 'CYB.ATOM.0047', 'CYB.ATOM.0050',
];

const DEVOPS_ATOMS = [
  'CYB.ATOM.0001', 'CYB.ATOM.0002', 'CYB.ATOM.0003', 'CYB.ATOM.0004',
  'CYB.ATOM.0008', 'CYB.ATOM.0012', 'CYB.ATOM.0016', 'CYB.ATOM.0017',
  'CYB.ATOM.0022', 'CYB.ATOM.0024', 'CYB.ATOM.0037', 'CYB.ATOM.0039',
  'CYB.ATOM.0040', 'CYB.ATOM.0041', 'CYB.ATOM.0042', 'CYB.ATOM.0043',
  'CYB.ATOM.0044', 'CYB.ATOM.0045', 'CYB.ATOM.0046', 'CYB.ATOM.0047',
  'CYB.ATOM.0048', 'CYB.ATOM.0049', 'CYB.ATOM.0050', 'CYB.ATOM.0051',
  'CYB.ATOM.0052', 'CYB.ATOM.0053', 'CYB.ATOM.0054',
];

export const PROFILE_SEEDS: ProfileSeed[] = [
  {
    slug: 'python_backend',
    name: 'Python Backend Developer',
    version: '0.1.0',
    status: 'candidate',
    requirements: requirements(PYTHON_BACKEND_ATOMS),
  },
  {
    slug: 'qa_automation',
    name: 'QA Automation Engineer',
    version: '0.1.0',
    status: 'candidate',
    requirements: requirements(QA_AUTOMATION_ATOMS),
  },
  {
    slug: 'devops',
    name: 'DevOps Engineer',
    version: '0.1.0',
    status: 'candidate',
    requirements: requirements(DEVOPS_ATOMS),
  },
];

// Санити-чек: атомы в профилях должны существовать (проверка на этапе запуска).
if (
  PROFILE_SEEDS.length !== 3 ||
  PYTHON_BACKEND_ATOMS.length === 0 ||
  QA_AUTOMATION_ATOMS.length === 0 ||
  DEVOPS_ATOMS.length === 0
) {
  throw new Error('PROFILE_SEEDS: ожидалось 3 профиля с непустыми атомами.');
}