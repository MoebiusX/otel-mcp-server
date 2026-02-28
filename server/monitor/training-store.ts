/**
 * Training Data Store
 * 
 * Collects and stores labeled training examples for LLM fine-tuning.
 * Users rate AI responses as good/bad and optionally provide corrections.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../lib/logger';

const logger = createLogger('training-store');

// Training example structure
export interface TrainingExample {
    id: string;
    timestamp: string;

    // Anomaly context
    anomaly: {
        id: string;
        service: string;
        operation: string;
        duration: number;
        deviation: number;
        severity: number;
        severityName: string;
    };

    // LLM interaction
    prompt: string;
    completion: string;

    // User feedback
    rating: 'good' | 'bad';
    correction?: string;      // User's corrected response (if rated bad)
    notes?: string;           // Additional notes
}

// Stats for the training dataset
export interface TrainingStats {
    totalExamples: number;
    goodExamples: number;
    badExamples: number;
    uniqueServices: string[];
    lastUpdated: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TRAINING_FILE = path.join(DATA_DIR, 'training-examples.json');

class TrainingStore {
    private examples: TrainingExample[] = [];
    private loaded = false;

    constructor() {
        this.ensureDataDir();
        this.load();
    }

    private ensureDataDir(): void {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    private load(): void {
        try {
            if (fs.existsSync(TRAINING_FILE)) {
                const data = fs.readFileSync(TRAINING_FILE, 'utf-8');
                this.examples = JSON.parse(data);
                logger.info({ examplesCount: this.examples.length }, 'Loaded training examples');
            } else {
                this.examples = [];
                logger.info('No existing training data, starting fresh');
            }
            this.loaded = true;
        } catch (error: unknown) {
            logger.error({ err: error }, 'Failed to load training data');
            this.examples = [];
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(TRAINING_FILE, JSON.stringify(this.examples, null, 2));
        } catch (error: unknown) {
            logger.error({ err: error }, 'Failed to save training data');
        }
    }

    /**
     * Add a new training example
     */
    addExample(example: Omit<TrainingExample, 'id' | 'timestamp'>): TrainingExample {
        const newExample: TrainingExample = {
            id: `train_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            ...example
        };

        this.examples.push(newExample);
        this.save();

        logger.info({ rating: example.rating, service: example.anomaly.service }, 'Added training example');
        return newExample;
    }

    /**
     * Get all examples
     */
    getAll(): TrainingExample[] {
        return [...this.examples];
    }

    /**
     * Get training statistics
     */
    getStats(): TrainingStats {
        const services = new Set(this.examples.map(e => e.anomaly.service));

        return {
            totalExamples: this.examples.length,
            goodExamples: this.examples.filter(e => e.rating === 'good').length,
            badExamples: this.examples.filter(e => e.rating === 'bad').length,
            uniqueServices: Array.from(services),
            lastUpdated: this.examples.length > 0
                ? this.examples[this.examples.length - 1].timestamp
                : ''
        };
    }

    /**
     * Export to JSONL format for training
     * 
     * For "good" examples: prompt + completion (as-is)
     * For "bad" examples with correction: prompt + correction (corrected response)
     * 
     * Also includes original_completion for bad examples so trainers can see
     * what the LLM said vs what it should have said.
     */
    exportToJsonl(): string {
        const lines: string[] = [];

        for (const example of this.examples) {
            // Skip bad examples without corrections (they're noise)
            if (example.rating === 'bad' && !example.correction) {
                continue;
            }

            if (example.rating === 'good') {
                // Good example: use original response
                lines.push(JSON.stringify({
                    prompt: example.prompt,
                    completion: example.completion
                }));
            } else {
                // Bad example with correction: use correction as target, keep original for context
                lines.push(JSON.stringify({
                    prompt: example.prompt,
                    completion: example.correction,              // What LLM should have said
                    original_completion: example.completion,     // What LLM actually said (for analysis)
                    rating: 'bad'
                }));
            }
        }

        return lines.join('\n');
    }

    /**
     * Clear all training data (use with caution!)
     */
    clear(): void {
        this.examples = [];
        this.save();
        logger.info('Cleared all training data');
    }

    /**
     * Delete a specific example
     */
    delete(id: string): boolean {
        const index = this.examples.findIndex(e => e.id === id);
        if (index !== -1) {
            this.examples.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }
}

// Singleton
export const trainingStore = new TrainingStore();
