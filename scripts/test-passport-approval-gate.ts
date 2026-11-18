// I.9.09.XX — Smoke: approved atom / criteria / applicability gate.
// Runs only in the disposable CI database after prepare-passport-test-fixtures.

import 'dotenv/config';

import { queryOne, query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  ensureActor,
  login,
  request,
  BASE,
} from './lib/passport-fixtures.js';

const ARCHITECT_PHONE = process.env['TEST_ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASS = process.env['TEST_ARCHITECT_PASS'] ?? 'ChangeMe123456';
const ATOM_ID = 'CYB.ATOM.0009';

async function main(): Promise<void> {
  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS, BASE);
  const subject = await ensureActor(admin.token, { name: 'approval-gate subject' }, BASE);
  const assessor = await ensureActor(
    admin.token, { name: 'approval-gate assessor', role: 'VERIFIER' }, BASE,
  );

  const original = await queryOne<{
    status: string;
    assessment_criteria: Record<string, unknown>;
    dimension_applicability: Record<string, unknown>;
  }>(
    `SELECT status, assessment_criteria, dimension_applicability
       FROM competency_atoms WHERE atom_id = $1`,
    [ATOM_ID],
  );
  if (!original) {throw new Error(`Missing test atom ${ATOM_ID}`);}

  const submit = () => request(
    'POST',
    '/passport/assessments',
    {
      participantId: subject.id,
      atomId: ATOM_ID,
      dimension: 'U',
      level: 5,
      method: 'approval-gate integration test',
    },
    assessor.token,
    BASE,
  );

  try {
    // 1. Candidate atom + draft criteria must not produce a confirmed state.
    await query(
      `UPDATE competency_atoms
          SET status = 'candidate',
              assessment_criteria = jsonb_set($2::jsonb, '{status}', '"draft"'::jsonb, true)
        WHERE atom_id = $1`,
      [ATOM_ID, JSON.stringify(original.assessment_criteria)],
    );
    const candidate = await submit();
    if (candidate.status !== 422) {
      throw new Error(`Candidate atom should be rejected with 422, got ${candidate.status}: ${JSON.stringify(candidate.data)}`);
    }

    // 2. Approved atom with draft criteria must still be rejected.
    await query(
      `UPDATE competency_atoms
          SET status = 'approved',
              assessment_criteria = jsonb_set($2::jsonb, '{status}', '"draft"'::jsonb, true)
        WHERE atom_id = $1`,
      [ATOM_ID, JSON.stringify(original.assessment_criteria)],
    );
    const draftCriteria = await submit();
    if (draftCriteria.status !== 422) {
      throw new Error(`Draft criteria should be rejected with 422, got ${draftCriteria.status}: ${JSON.stringify(draftCriteria.data)}`);
    }

    // 3. Approved atom with missing applicability decision must be rejected.
    await query(
      `UPDATE competency_atoms
          SET status = 'approved',
              assessment_criteria = jsonb_set($2::jsonb, '{status}', '"approved"'::jsonb, true),
              dimension_applicability = dimension_applicability - 'U'
        WHERE atom_id = $1`,
      [ATOM_ID, JSON.stringify(original.assessment_criteria)],
    );
    const unresolved = await submit();
    if (unresolved.status !== 422) {
      throw new Error(`Unresolved applicability should be rejected with 422, got ${unresolved.status}: ${JSON.stringify(unresolved.data)}`);
    }

    // 4. Explicitly applicable, but without an approved criterion for U.
    await query(
      `UPDATE competency_atoms
          SET dimension_applicability = jsonb_set(dimension_applicability, '{U}', '{"applicable":true}'::jsonb, true),
              assessment_criteria = jsonb_set($2::jsonb, '{status}', '"approved"'::jsonb, true) - 'U'
        WHERE atom_id = $1`,
      [ATOM_ID, JSON.stringify(original.assessment_criteria)],
    );
    const missingCriterion = await submit();
    if (missingCriterion.status !== 422) {
      throw new Error(`Missing dimension criterion should be rejected with 422, got ${missingCriterion.status}: ${JSON.stringify(missingCriterion.data)}`);
    }

    // 5. Explicit applicability + approved non-empty criterion permits assessment.
    await query(
      `UPDATE competency_atoms
          SET dimension_applicability = jsonb_set(dimension_applicability, '{U}', '{"applicable":true}'::jsonb, true),
              assessment_criteria = jsonb_set(
                jsonb_set($2::jsonb, '{status}', '"approved"'::jsonb, true),
                '{U}', '"CI approved criterion: explain the atom accurately"'::jsonb, true
              )
        WHERE atom_id = $1`,
      [ATOM_ID, JSON.stringify(original.assessment_criteria)],
    );
    const accepted = await submit();
    if (accepted.status !== 201) {
      throw new Error(`Approved atom should accept assessment with 201, got ${accepted.status}: ${JSON.stringify(accepted.data)}`);
    }

    const state = await queryOne<{ status: string; level: number | null }>(
      `SELECT status, level FROM person_atom_states
        WHERE participant_id = $1 AND atom_id = $2 AND dimension = 'U'`,
      [subject.id, ATOM_ID],
    );
    if (state?.status !== 'confirmed' || state.level !== 5) {
      throw new Error(`Accepted assessment did not create expected confirmed state: ${JSON.stringify(state)}`);
    }

    console.log('PASS passport approval gate: candidate/draft, unresolved applicability and missing criterion rejected; approved criterion accepted.');
  } finally {
    await query(
      `UPDATE competency_atoms
          SET status = $2,
              assessment_criteria = $3::jsonb,
              dimension_applicability = $4::jsonb
        WHERE atom_id = $1`,
      [
        ATOM_ID,
        original.status,
        JSON.stringify(original.assessment_criteria),
        JSON.stringify(original.dimension_applicability),
      ],
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gracefulShutdown();
  });
