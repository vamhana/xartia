// CI-only passport fixtures. Never run against a production database.
// Pilot catalogue entries remain candidate/draft in the real seed.

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { ATOM_SEEDS } from './seed-data/atoms.js';

async function main(): Promise<void> {
  // Exact positive-path atoms referenced by the legacy passport smoke suite.
  // Other pilot atoms remain candidate/draft in this disposable test DB too.
  const fixtureIds = new Set([
    'CYB.ATOM.0002', 'CYB.ATOM.0003', 'CYB.ATOM.0004',
    'CYB.ATOM.0005', 'CYB.ATOM.0006', 'CYB.ATOM.0009',
    'CYB.ATOM.0010',
    'CYB.ATOM.0030', 'CYB.ATOM.0031', 'CYB.ATOM.0032',
    'CYB.ATOM.0033', 'CYB.ATOM.0034',
    'CYB.ATOM.0042', 'CYB.ATOM.0043', 'CYB.ATOM.0044',
    'CYB.ATOM.0045', 'CYB.ATOM.0046',
  ]);
  const ids = ATOM_SEEDS.filter((atom) => fixtureIds.has(atom.atom_id)).map((atom) => atom.atom_id);
  const result = await query<{ atom_id: string }>(
    `UPDATE competency_atoms
        SET status = 'approved',
            assessment_criteria =
              jsonb_set(
                COALESCE(assessment_criteria, '{}'::jsonb),
                '{status}', '"approved"'::jsonb, true
              )
              || jsonb_build_object(
                'U', COALESCE(NULLIF(assessment_criteria->>'U', ''), 'CI fixture: demonstrates understanding of the atom'),
                'X', COALESCE(NULLIF(assessment_criteria->>'X', ''), 'CI fixture: explains the atom and its boundaries'),
                'D', COALESCE(NULLIF(assessment_criteria->>'D', ''), 'CI fixture: designs a valid approach for the atom'),
                'P', COALESCE(NULLIF(assessment_criteria->>'P', ''), 'CI fixture: performs the atom to the expected result'),
                'E', COALESCE(NULLIF(assessment_criteria->>'E', ''), 'CI fixture: evaluates the result against the atom criteria')
              )
      WHERE atom_id = ANY($1::text[])
      RETURNING atom_id`,
    [ids],
  );
  if (ids.length !== fixtureIds.size) {
    throw new Error(`Expected ${fixtureIds.size} declared fixture atoms, found ${ids.length}`);
  }
  if (result.length !== ids.length) {
    throw new Error(`Expected to prepare ${ids.length} passport fixtures, updated ${result.length}`);
  }
  console.log(`Prepared ${result.length} CI-only approved passport fixtures.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gracefulShutdown();
  });
