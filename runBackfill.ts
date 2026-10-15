import { supabase } from './lib/supabase';
import { backfillUserMemories } from './utils/backfillMemories';

async function runBackfill() {
    console.log("Fetching users from mood_entries table...");
    const { data: users, error } = await supabase.from('mood_entries').select('user_id');

    if (error) {
        console.error("Error fetching users:", error);
        return;
    }

    if (!users || users.length === 0) {
        console.log("No users found to backfill.");
        return;
    }

    const uniqueUsers = Array.from(new Set(users.map((u: any) => u.user_id)));
    console.log(`Found ${uniqueUsers.length} unique user(s). Starting backfill...`);

    for (const userId of uniqueUsers) {
        console.log(`\\n--- Backfilling for user: ${userId} ---`);
        await backfillUserMemories(userId as string, (msg) => {
            console.log(`[Backfill] ${msg}`);
        });
    }

    console.log("\\n=== All users backfilled successfully ===");
    process.exit(0);
}

runBackfill();
