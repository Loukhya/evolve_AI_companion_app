import { pipeline, env } from '@huggingface/transformers';
import { supabase } from '../lib/supabase'; // Assuming supabase client is standard exported here

// Set environment settings to prevent trying to load local node files in the browser
env.allowLocalModels = false;

class EmbeddingEngine {
    private static instance: EmbeddingEngine;
    private extractor: any = null;
    private initializingPromise: Promise<void> | null = null;
    private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

    private constructor() { }

    public static getInstance(): EmbeddingEngine {
        if (!EmbeddingEngine.instance) {
            EmbeddingEngine.instance = new EmbeddingEngine();
        }
        return EmbeddingEngine.instance;
    }

    private async initialize() {
        if (this.extractor) return;

        if (this.initializingPromise) {
            await this.initializingPromise;
            return;
        }

        console.log('[Embedding] Loading local model inside browser...');
        this.initializingPromise = new Promise(async (resolve, reject) => {
            try {
                this.extractor = await pipeline(
                    'feature-extraction',
                    this.MODEL_NAME,
                    {
                        // Explicitly specifying the task helps ensure web compat
                        revision: 'main',
                        dtype: 'q8'
                    }
                );
                console.log('[Embedding] Transformers model ready.');
                resolve();
            } catch (err) {
                console.error('[Embedding] Initialization failed:', err);
                reject(err);
            }
        });

        await this.initializingPromise;
    }

    public async generate(text: string): Promise<number[]> {
        if (!text || text.trim() === '') return [];

        await this.initialize();

        try {
            // Pool average ensures we get one dense vector (1x384) instead of multiple word vectors
            const output = await this.extractor(text, { pooling: 'mean', normalize: true });

            // Extract the float array mapped from the underlying Float32Array tensor
            return Array.from(output.data);
        } catch (error) {
            console.error('[Embedding] Failed to generate embedding for', text.substring(0, 30), error);
            throw error;
        }
    }

    /**
     * Store the string along with its vector to the Supabase graph structure
     */
    public async storeMemory(userId: string, contentType: 'journal' | 'mood' | 'chat' | 'insight' | 'interest', content: string, sourceId?: string) {
        try {
            const vector = await this.generate(content);

            if (vector.length === 0) return;

            const { error } = await supabase
                .from('memory_nodes')
                .insert({
                    user_id: userId,
                    content_type: contentType,
                    content: content,
                    embedding: vector,
                    source_id: sourceId
                });

            if (error) {
                console.error('[Embedding] Storage error', error);
            }
        } catch (err) {
            console.error('[Embedding] process failure on storing memory', err);
        }
    }

    /**
     * Retrieve matching string memory nodes
     */
    public async searchMemories(userId: string, query: string, match_count: number = 5): Promise<any[]> {
        try {
            const vector = await this.generate(query);

            if (vector.length === 0) return [];

            // Format array brackets as string to properly pass via pg_graphql / rpc
            const queryEmbeddingArrayString = `[${vector.join(',')}]`;

            const { data, error } = await supabase.rpc('match_memories', {
                query_embedding: queryEmbeddingArrayString,
                match_threshold: 0.1, // Relaxed semantic match to prevent empty results, lower threshold = looser match
                match_count: match_count,
                p_user_id: userId
            });

            if (error) {
                console.error('[Embedding] Retrieval Error', error);
                return [];
            }

            return data || [];
        } catch (err) {
            console.error('[Embedding] process failure on reading memory', err);
            return [];
        }
    }
}

export const embeddingEngine = EmbeddingEngine.getInstance();
