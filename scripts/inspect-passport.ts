import 'dotenv/config';
import { query, queryOne } from '../src/lib/db.js';

const atoms    = await queryOne<{ n: number }>('select count(*)::int n from competency_atoms');
const rels     = await queryOne<{ n: number }>('select count(*)::int n from competency_relations');
const profiles = await queryOne<{ n: number }>('select count(*)::int n from profession_profiles');

const sample = await query<{ atom_id: string; version: number }>(
  'select atom_id, version from competency_atoms order by atom_id limit 5',
);

console.log({
  atoms:    atoms?.n,
  relations: rels?.n,
  profiles: profiles?.n,
});
console.log('sample:', sample);
process.exit(0);