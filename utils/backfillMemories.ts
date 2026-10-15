import { supabase } from '../lib/supabase';
import { embeddingEngine } from '../services/embeddingService';
import { fetchMoodEntries, fetchJournalEntries, fetchChatHistory, fetchAllArchetypeChatHistory, fetchUserInterests } from '../services/database';
import { compressJournalForMemory, compressChatForMemory } from '../services/groq';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Iterates through all past un-embedded user history items and saves them to the pgvector graph.
 */
export async function backfillUserMemories(userId: string, onProgress?: (msg: string) => void) {
    if (!userId) return;

    try {
        const log = (m: string) => {
            console.log(m);
            if (onProgress) onProgress(m);
        };

        log('Initializing local AI model for vector embeddings...');
        log('Fetching existing records...');

        const [moods, journals, chats, councilChats, interests, existingNodesResponse] = await Promise.all([
            fetchMoodEntries(userId).catch(() => []),
            fetchJournalEntries(userId).catch(() => []),
            fetchChatHistory(userId, 200).catch(() => []), // Higher limit to get all recent history
            fetchAllArchetypeChatHistory(userId, 500).catch(() => []),
            fetchUserInterests(userId).catch(() => []),
            supabase.from('memory_nodes').select('source_id, content').eq('user_id', userId)
        ]);

        const processedSourceIds = new Set(
            (existingNodesResponse.data || [])
                .map(n => n.source_id)
                .filter(id => id != null)
        );

        const processedContents = new Set(
            (existingNodesResponse.data || [])
                .map(n => n.content)
                .filter(c => c != null)
        );

        // Filter out already processed items (using both explicit tracking ID and legacy raw text match)
        const newJournals = journals.filter(j => !processedSourceIds.has(j.date) && !processedContents.has(j.content));

        const newMoods = moods.filter(m => {
            if (m.id && processedSourceIds.has(m.id)) return false;
            const memoryString = `User felt ${m.mood.name} (score: ${m.mood.score}/10). ${m.emotion?.label ? `Primary emotion was ${m.emotion.label}.` : ''}`;
            if (processedContents.has(memoryString)) return false;
            return true;
        });

        const newChats = chats.filter(c => c.role === 'user' && c.content.trim().length > 15 && !processedSourceIds.has(c.id) && !processedContents.has(c.content));

        const newCouncilChats = councilChats.filter(c => c.role === 'user' && c.content.trim().length > 15 && !processedSourceIds.has(c.id) && !processedContents.has(c.content));

        const newInterests = interests.filter(int => {
            if (int.id && processedSourceIds.has(int.id)) return false;
            const memoryString = int.genres && int.genres.length > 0
                ? `User is interested in ${int.category}: ${int.name} (Genres: ${int.genres.join(', ')})`
                : `User is interested in ${int.category}: ${int.name}`;
            if (processedContents.has(memoryString)) return false;
            return true;
        });

        log(`Found ${newMoods.length} new moods, ${newJournals.length} new journals, ${newChats.length} new chats, ${newCouncilChats.length} new council chats, and ${newInterests.length} new interests.`);

        // 1. Process Journals
        for (let i = 0; i < newJournals.length; i++) {
            log(`Processing Journal ${i + 1}/${newJournals.length}...`);
            const compressed = await compressJournalForMemory(newJournals[i].content);
            await embeddingEngine.storeMemory(userId, 'journal', compressed, newJournals[i].date);
            await delay(1500); // Prevent Groq rate limiting during backfill
        }

        // 2. Process Moods
        for (let i = 0; i < newMoods.length; i++) {
            log(`Processing Mood ${i + 1}/${newMoods.length}...`);
            const mood = newMoods[i].mood;
            const emotion = newMoods[i].emotion;
            const memoryString = `User felt ${mood.name} (score: ${mood.score}/10). ${emotion?.label ? `Primary emotion was ${emotion.label}.` : ''}`;
            await embeddingEngine.storeMemory(userId, 'mood', memoryString, newMoods[i].id);
            // No delay needed here since we bypass Groq for moods now
        }

        // 3. Process Chats (Only User Messages)
        for (let i = 0; i < newChats.length; i++) {
            log(`Processing Chat ${i + 1}/${newChats.length}...`);
            const compressed = await compressChatForMemory(newChats[i].content);
            if (compressed) {
                await embeddingEngine.storeMemory(userId, 'chat', compressed, newChats[i].id);
            }
            await delay(1500); // Prevent Groq rate limiting during backfill
        }

        // 4. Process Council Chats
        for (let i = 0; i < newCouncilChats.length; i++) {
            log(`Processing Council Chat ${i + 1}/${newCouncilChats.length}...`);
            const compressed = await compressChatForMemory(newCouncilChats[i].content);
            if (compressed) {
                await embeddingEngine.storeMemory(userId, 'chat', compressed, newCouncilChats[i].id);
            }
            await delay(1500); // Prevent Groq rate limiting during backfill
        }

        // 5. Process Interests
        for (let i = 0; i < newInterests.length; i++) {
            log(`Processing Interest ${i + 1}/${newInterests.length}...`);
            const genres = newInterests[i].genres;
            const memoryString = genres && genres.length > 0
                ? `User is interested in ${newInterests[i].category}: ${newInterests[i].name} (Genres: ${genres.join(', ')})`
                : `User is interested in ${newInterests[i].category}: ${newInterests[i].name}`;
            await embeddingEngine.storeMemory(userId, 'interest', memoryString, newInterests[i].id);
        }

        log('Backfill Complete! All memories have been loaded into the Vector Graph.');

    } catch (err) {
        console.error('CRITICAL BACKFILL ERROR:', err);
    }
}
