/** Load the synthetic Gurugram earthquake into Supabase (owned by one seed user). */
import { supabase } from '../src/store.js';
import { syntheticReports } from '../src/synthetic.js';

const db = supabase();
const email = 'seed-reporter@crisispulse.local';
let userId: string | undefined;
const { data: list } = await db.auth.admin.listUsers();
userId = list?.users.find((u) => u.email === email)?.id;
if (!userId) {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
}
const rows = syntheticReports().map(({ id: _id, extracted: _x, cluster_id: _c, processed_at: _p, ...r }) => ({ ...r, user_id: userId }));
const { error } = await db.from('reports').upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
if (error) throw error;
console.log(`Seeded ${rows.length} reports. Start the worker (npm run worker) to process them.`);
